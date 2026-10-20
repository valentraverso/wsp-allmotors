import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import whatsappService from './whatsapp';
import { authMiddleware } from './middleware/auth';
import QRCode from 'qrcode';

// Configuración de zona horaria Argentina (America/Argentina/Buenos_Aires) para los logs
function getArgentinaTimestamp(): string {
    const now = new Date();
    return now.toLocaleString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalInfo = console.info;

function shouldFilterLog(args: any[]): boolean {
    for (const arg of args) {
        if (typeof arg === 'string') {
            if (arg.includes('Closing session:') || arg.includes('Closing stale open session') || arg.includes('SessionEntry')) {
                return true;
            }
        } else if (arg && typeof arg === 'object') {
            if (arg.constructor?.name === 'SessionEntry' || ('_chains' in arg && 'registrationId' in arg)) {
                return true;
            }
        }
    }
    return false;
}

console.log = (...args: any[]) => {
    if (shouldFilterLog(args)) return;
    originalLog(`[${getArgentinaTimestamp()}]`, ...args);
};
console.warn = (...args: any[]) => {
    if (shouldFilterLog(args)) return;
    originalWarn(`[${getArgentinaTimestamp()}]`, ...args);
};
console.error = (...args: any[]) => {
    if (shouldFilterLog(args)) return;
    originalError(`[${getArgentinaTimestamp()}]`, ...args);
};
console.info = (...args: any[]) => {
    if (shouldFilterLog(args)) return;
    originalInfo(`[${getArgentinaTimestamp()}]`, ...args);
};

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4002;

// Endpoint para obtener el QR
app.get('/qr', async (req, res) => {
    const qr = whatsappService.getQR();
    if (qr) {
        try {
            const qrImage = await QRCode.toDataURL(qr);
            res.status(200).json({ qr: qrImage });
        } catch (err) {
            res.status(500).json({ error: 'Failed to generate QR image' });
        }
    } else {
        res.status(404).json({ message: 'QR not available or already connected' });
    }
});

// Health check
app.get('/status', (req, res) => {
    res.json({ 
        service: 'wsp-bot',
        status: whatsappService.sock?.user ? 'connected' : 'disconnected' 
    });
});

import geminiService from './services/gemini';
import axios from 'axios';
import { getBackendApiKey, getCleanBackendUrl } from './agent/config/env';

// Endpoint para desvincular/logout de WhatsApp Commercial Bot
app.post('/logout', authMiddleware, async (req, res) => {
    try {
        await whatsappService.logout();
        res.status(200).json({ status: 'success', message: 'WhatsApp Commercial Bot session logged out.' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint protegido para procesar mensajes de canales omnicanal (WhatsApp Cloud API, Instagram Direct y Facebook Messenger)
app.post('/api/v1/bot/chat', authMiddleware, async (req, res) => {
    try {
        const { conversationId, channel, senderId, text, mediaData } = req.body;
        if (!conversationId || typeof conversationId !== 'string' || (!text && !mediaData)) {
            return res.status(400).json({ error: 'conversationId y text (o mediaData) son requeridos y deben ser válidos' });
        }

        const resolvedChannel = (channel || 'WHATSAPP').toUpperCase();
        const senderJid = `${resolvedChannel.toLowerCase()}:${senderId}`;
        const cleanSenderPhone = resolvedChannel === 'WHATSAPP' ? String(senderId || '').replace(/\D/g, '') : '';

        const backendUrl = getCleanBackendUrl();
        const apiKey = getBackendApiKey();

        // 1. Obtener contexto del cliente desde backend (con fallback por teléfono para vincular leads y consultas previas)
        let clientContext: any = null;
        try {
            const contextUrl = `${backendUrl}/api/v1/crm/conversation/resolve-context/${encodeURIComponent(conversationId)}${cleanSenderPhone ? `?phone=${encodeURIComponent(cleanSenderPhone)}` : ''}`;
            const contextRes = await axios.get(contextUrl, {
                headers: { 'x-api-key': apiKey },
                timeout: 10000
            });
            clientContext = contextRes.data?.data?.clientContext || contextRes.data?.data || null;
        } catch (e: any) {
            console.error(`[WSP BOT Chat Context Error]: ${e.message}`);
        }

        // 2. Obtener historial previo de la conversación desde backend
        let history: any[] = [];
        try {
            const chatRes = await axios.get(`${backendUrl}/api/v1/crm/conversations/${encodeURIComponent(conversationId)}`, {
                headers: { 'x-api-key': apiKey },
                timeout: 10000
            });
            const rawMsgs = chatRes.data?.data?.messages || chatRes.data?.data?.history || chatRes.data?.data?.conversation?.messages || [];
            if (Array.isArray(rawMsgs) && rawMsgs.length > 0) {
                history = rawMsgs.map((m: any) => {
                    const textVal = m.text || m.parts?.[0]?.text || (typeof m.content === 'string' ? m.content : '');
                    return {
                        role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
                        text: textVal,
                        parts: [{ text: textVal }]
                    };
                }).filter((h: any) => h.text);
            }

            // Si la conversación tiene <= 1 mensaje pero tenemos teléfono, cargar historial previo por teléfono para dar continuidad
            if (history.length <= 1 && cleanSenderPhone) {
                try {
                    const phoneChatRes = await axios.get(`${backendUrl}/api/v1/crm/chats/${encodeURIComponent(cleanSenderPhone)}`, {
                        headers: { 'x-api-key': apiKey },
                        timeout: 10000
                    });
                    const phoneMsgs = phoneChatRes.data?.data?.messages || phoneChatRes.data?.data?.history || [];
                    if (Array.isArray(phoneMsgs) && phoneMsgs.length > 0) {
                        const olderHistory = phoneMsgs.map((m: any) => {
                            const textVal = m.text || m.parts?.[0]?.text || (typeof m.content === 'string' ? m.content : '');
                            return {
                                role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
                                text: textVal,
                                parts: [{ text: textVal }]
                            };
                        }).filter((h: any) => h.text);
                        if (olderHistory.length > history.length) {
                            history = olderHistory;
                        }
                    }
                } catch {
                    // ignore
                }
            }
        } catch (e) {
            // No bloqueante
        }

        // 3. Invocar a Manuel Botardo (LangChain + Letta Memory + Langfuse) con callback de crédito diferido y soporte multimodal
        const aiResult = await geminiService.chat(
            text || '[Archivo multimedia recibido]',
            history,
            cleanSenderPhone,
            senderJid,
            clientContext,
            conversationId,
            "",
            (creditData) => {
                whatsappService.handleDeferredCreditCheck(
                    creditData.jid,
                    creditData.senderNumber,
                    creditData.dni,
                    creditData.gender,
                    creditData.conversationId,
                    creditData.isGuarantor,
                    creditData.guarantorName,
                    creditData.relationship
                ).catch((err: any) => {
                    console.error(`[WSP BOT Deferred Credit Error]: ${err.message}`);
                });
            },
            mediaData
        );

        res.status(200).json({
            status: true,
            replyText: aiResult?.text || ""
        });
    } catch (error: any) {
        console.error(`[WSP BOT Omnichannel Chat Error]:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`[WSP BOT] Commercial AI Bot Service running on port ${PORT}`);
    whatsappService.init();
});
