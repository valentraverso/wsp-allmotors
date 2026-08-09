import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    ConnectionState,
    WASocket,
    downloadMediaMessage,
    WAMessageContent,
    WAMessageKey,
    proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import qrcodeTerminal from 'qrcode-terminal';
import geminiService from './services/gemini';
import axios from 'axios';
import FormData from 'form-data';

dotenv.config({ path: path.join(__dirname, '../.env') });

const groupCache = new Map<string, any>();
const userStates = new Map<string, { step: string; history: any[]; lastActivity?: number }>();
const userMessageBatches = new Map<string, { messages: string[]; timer: NodeJS.Timeout; msgObj: any }>();

function getApiKey(): string {
    let key = (process.env.BACKEND_API_KEY || process.env.SYSTEM_ADMIN_API_KEY || process.env.EXTERNAL_SERVICE_API_KEY || "").trim();
    if (!key) {
        try {
            const envPath = path.join(__dirname, '../.env');
            if (fs.existsSync(envPath)) {
                const content = fs.readFileSync(envPath, 'utf8');
                const match = content.match(/BACKEND_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
                if (match && match[1]) {
                    key = match[1].trim();
                }
            }
        } catch (e) {
            // ignore
        }
    }
    return key;
}

class BotWhatsappService {
    public sock: WASocket | null = null;
    private qr: string | null = null;
    private isInitializing = false;

    async init() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            console.log('[WSP BOT] Initializing Commercial AI Bot Service...');
            
            if (this.sock) {
                try {
                    this.sock.ev.removeAllListeners('connection.update');
                    this.sock.ev.removeAllListeners('creds.update');
                    this.sock.ev.removeAllListeners('messages.upsert');
                    this.sock.end(undefined);
                } catch (e) {
                    console.log('[WSP BOT] Prev connection already closed');
                }
                this.sock = null;
            }

            const authFolder = process.env.AUTH_DIR || 'auth_info_baileys_bot';
            const authPath = path.resolve(process.cwd(), authFolder);
            const { state, saveCreds } = await useMultiFileAuthState(authPath);
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
                },
                logger: pino({ level: 'silent' }),
                generateHighQualityLinkPreview: true,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                cachedGroupMetadata: async (jid) => groupCache.get(jid),
                getMessage: async (key: WAMessageKey): Promise<WAMessageContent | undefined> => undefined
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    this.qr = qr;
                    console.log(`[WSP BOT] New QR Code generated. Scan with your Commercial Bot WhatsApp:`);
                    qrcodeTerminal.generate(qr, { small: true });
                }
                
                if (connection === 'close') {
                    const error = lastDisconnect?.error as Boom;
                    const statusCode = error?.output?.statusCode;
                    const errorMessage = error?.message || '';
                    
                    console.log(`[WSP BOT] Connection closed. Status code: ${statusCode}. Error: ${errorMessage}`);
                    this.isInitializing = false;
                    
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log(`[WSP BOT] Session logged out. Clearing credentials folder (${authPath})...`);
                        try {
                            if (fs.existsSync(authPath)) {
                                fs.rmSync(authPath, { recursive: true, force: true });
                            }
                        } catch (err) {
                            console.error('[WSP BOT] Error clearing credentials folder:', err);
                        }
                        setTimeout(() => this.init(), 2000);
                    } else {
                        console.log('[WSP BOT] Reconnecting in 5 seconds...');
                        setTimeout(() => this.init(), 5000);
                    }
                } else if (connection === 'open') {
                    this.qr = null;
                    this.isInitializing = false;
                    console.log(`✓ [WSP BOT] WhatsApp Commercial AI Bot connected successfully!`);
                    setTimeout(() => this.recoverPendingConversations(), 5000);
                }
            });

            this.sock.ev.on('messages.upsert', async (m) => {
                if (m.type !== 'notify') return;

                for (const msg of m.messages) {
                    if (!msg.message || msg.key.fromMe) continue;
                    
                    const senderJid = msg.key.remoteJid;
                    if (!senderJid) continue;
                    
                    if (senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') {
                        continue;
                    }

                    // Resolver número de teléfono real (PN)
                    let senderNumber = '';
                    if (senderJid.endsWith('@s.whatsapp.net')) {
                        senderNumber = senderJid.replace('@s.whatsapp.net', '');
                    } else if (senderJid.endsWith('@lid')) {
                        const altJid = (msg.key as any).remoteJidAlt || (msg as any).participantAlt;
                        if (altJid && typeof altJid === 'string' && altJid.endsWith('@s.whatsapp.net')) {
                            senderNumber = altJid.replace('@s.whatsapp.net', '');
                        } else {
                            senderNumber = senderJid.replace(/\D/g, '');
                        }
                    } else {
                        senderNumber = senderJid.replace(/\D/g, '');
                    }

                    const textMessage = msg.message.conversation || 
                                       msg.message.extendedTextMessage?.text || 
                                       msg.message.imageMessage?.caption || '';

                    if (!textMessage.trim()) continue;

                    // Agrupación ráfaga (Debounce 30s)
                    const existingBatch = userMessageBatches.get(senderJid);
                    if (existingBatch) {
                        clearTimeout(existingBatch.timer);
                        existingBatch.messages.push(textMessage.trim());
                        console.log(`[WSP BOT Batch] Agregando mensaje a la ráfaga de ${senderNumber} (Total: ${existingBatch.messages.length}): "${textMessage.trim()}"`);
                        
                        existingBatch.timer = setTimeout(async () => {
                            const fullText = existingBatch.messages.join(' | ');
                            const finalMsgObj = existingBatch.msgObj;
                            userMessageBatches.delete(senderJid);
                            await this.handleIncomingMessage(senderJid, senderNumber, fullText, finalMsgObj);
                        }, 30000);
                    } else {
                        console.log(`[WSP BOT Batch] Iniciando ráfaga de 30s para ${senderNumber}: "${textMessage.trim()}"`);
                        const timer = setTimeout(async () => {
                            const current = userMessageBatches.get(senderJid);
                            if (current) {
                                const fullText = current.messages.join(' | ');
                                const finalMsgObj = current.msgObj;
                                userMessageBatches.delete(senderJid);
                                await this.handleIncomingMessage(senderJid, senderNumber, fullText, finalMsgObj);
                            }
                        }, 30000);

                        userMessageBatches.set(senderJid, {
                            messages: [textMessage.trim()],
                            timer,
                            msgObj: msg
                        });
                    }
                }
            });

        } catch (error) {
            console.error('[WSP BOT] Error during WhatsApp init:', error);
            this.isInitializing = false;
            setTimeout(() => this.init(), 10000);
        }
    }

    private getCleanBackendUrl(): string {
        const raw = (process.env.BACKEND_URL || 'http://localhost:4000').trim();
        return raw.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
    }

    private async handleIncomingMessage(senderJid: string, senderNumber: string, combinedText: string, msg: any) {
        try {
            const backendUrl = this.getCleanBackendUrl();
            const apiKey = getApiKey();
            let leadProfile: any = null;
            let conversationId: string | undefined = undefined;

            // 1. Obtener perfil del Lead y sesión activa desde DB
            try {
                const activeRes = await axios.get(`${backendUrl}/api/v1/crm/conversation/active/${senderNumber}`, {
                    headers: { 'x-api-key': apiKey },
                    timeout: 5000
                });
                if (activeRes.data && activeRes.data.data) {
                    leadProfile = activeRes.data.data.lead;
                    if (activeRes.data.data.conversation) {
                        conversationId = activeRes.data.data.conversation.conversationId;
                    }
                }
            } catch (e) {
                // ignore
            }

            let state = userStates.get(senderJid);

            // Hidratar historial desde backend si no existe en RAM
            if (!state || !state.history || state.history.length === 0) {
                let loadedHistory: any[] = [];
                try {
                    const chatRes = await axios.get(`${backendUrl}/api/v1/crm/chats/${encodeURIComponent(senderJid)}`, {
                        headers: { 'x-api-key': apiKey },
                        timeout: 5000
                    });
                    if (chatRes.data && Array.isArray(chatRes.data.history)) {
                        loadedHistory = chatRes.data.history;
                        console.log(`[WSP BOT History] Hidratado historial previo de ${loadedHistory.length} mensajes desde DB para ${senderNumber}`);
                    }
                } catch (e) {
                    // ignore
                }

                state = {
                    step: 'CHATTING',
                    history: loadedHistory,
                    lastActivity: Date.now()
                };
                userStates.set(senderJid, state);
            }

            const history = state.history || [];

            // 2. Marcar estado como PENDIENTE en DB al recibir mensaje
            const syncUrl = `${backendUrl}/api/v1/crm/chat/sync`;
            try {
                await axios.post(syncUrl, {
                    jid: senderJid,
                    phone: senderNumber,
                    pushName: msg.pushName || "",
                    conversationId,
                    replyStatus: 'PENDIENTE',
                    lastMessage: combinedText,
                    updatedAt: new Date()
                }, {
                    headers: { 'x-api-key': apiKey },
                    timeout: 5000
                });
            } catch (err: any) {
                // ignore
            }

            // Corte de bucle de cortesía / emojis
            const isOnlyCourtesyOrEmoji = (text: string): boolean => {
                const cleaned = text.trim().toLowerCase().replace(/[^\w\s]/gi, '');
                const courtesyWords = ['gracias', 'muchas gracias', 'dale', 'chau', 'nos vemos', 'ok', 'oka', 'listo', 'buenísimo', 'buenisimo', 'de nada'];
                const isPureEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\d👍🙌😊]*$/u.test(text.trim());
                return isPureEmoji || (cleaned.length < 25 && courtesyWords.some(w => cleaned.includes(w)));
            };

            // Detección de indicios de cierre de conversación
            const isGoodbyeSignal = (text: string): boolean => {
                const cleaned = text.trim().toLowerCase();
                const goodbyeWords = ['hablamos mañana', 'hasta mañana', 'nos vemos mañana', 'chau', 'chau gracias', 'muchas gracias chau', 'nada mas', 'nada más', 'no necesito nada mas', 'no por ahora'];
                return goodbyeWords.some(w => cleaned.includes(w));
            };
            const isClosedSession = isGoodbyeSignal(combinedText);

            const lastHistoryMsg = history.length > 0 ? history[history.length - 1] : null;
            const lastBotText = lastHistoryMsg && lastHistoryMsg.role === 'model' ? (lastHistoryMsg.parts?.[0]?.text || '').toLowerCase() : '';

            if (isOnlyCourtesyOrEmoji(combinedText) && (lastBotText.includes('de nada') || lastBotText.includes('que tengas') || lastBotText.includes('cualquier duda') || /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]*$/u.test(lastBotText))) {
                console.log(`[WSP BOT Courtesy Cutoff] Bucle de cortesía/emoji detectado para ${senderNumber}. Silenciando respuesta.`);
                return;
            }

            // 3. Generar respuesta de Gemini inyectando perfil del cliente
            const aiResponse = await geminiService.chat(combinedText, history, senderNumber, senderJid, leadProfile);

            userStates.set(senderJid, {
                step: 'CHATTING',
                history: aiResponse.newHistory,
                lastActivity: Date.now()
            });

            if (aiResponse.text && aiResponse.text.trim()) {
                // Retardo aleatorio humano entre 20s y 2min (máximo 2 minutos)
                const minDelay = 20000;
                const maxDelay = 120000;
                const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                const delaySeconds = Math.round(randomDelay / 1000);
                console.log(`[WSP BOT Delay] Espera humana de ${delaySeconds}s (${(delaySeconds / 60).toFixed(1)} min) antes de enviar a ${senderNumber}...`);
                
                await new Promise(resolve => setTimeout(resolve, randomDelay));
                await this.sendMessage(senderJid, aiResponse.text.trim());
            }

            // 4. Marcar estado como ATENDIDO y actualizar sesión en DB
            const syncPayload = {
                jid: senderJid,
                phone: senderNumber,
                pushName: msg.pushName || "",
                conversationId,
                history: aiResponse.newHistory,
                lastMessage: combinedText,
                replyStatus: 'ATENDIDO',
                status: isClosedSession ? 'CLOSED' : 'ACTIVE',
                closeReason: isClosedSession ? 'USER_GOODBYE' : undefined,
                updatedAt: new Date()
            };

            try {
                await axios.post(syncUrl, syncPayload, {
                    headers: { 'x-api-key': apiKey },
                    timeout: 5000
                });
            } catch (err: any) {
                console.error(`[WSP BOT Sync Error] (${syncUrl}) ${err.message}`);
            }

        } catch (error: any) {
            console.error(`[WSP BOT Error] Error processing message from ${senderNumber}:`, error);
        }
    }

    public async recoverPendingConversations(): Promise<void> {
        const backendUrl = this.getCleanBackendUrl();
        const apiKey = getApiKey();
        try {
            console.log(`[WSP BOT Recovery] Verificando mensajes pendientes de respuesta en DB...`);
            const res = await axios.get(`${backendUrl}/api/v1/crm/conversation/pending`, {
                headers: { 'x-api-key': apiKey },
                timeout: 10000
            });
            const list = res.data?.conversations;
            if (Array.isArray(list) && list.length > 0) {
                console.log(`[WSP BOT Recovery] Se encontraron ${list.length} conversaciones pendientes tras reinicio. Procesando...`);
                for (const conv of list) {
                    const lastMsg = conv.messages && conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
                    if (lastMsg && lastMsg.role === 'user' && lastMsg.text) {
                        console.log(`[WSP BOT Recovery] Auto-respondiendo conversación pendiente para ${conv.phone}...`);
                        await this.handleIncomingMessage(conv.jid, conv.phone, lastMsg.text, { pushName: '' });
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }
        } catch (err: any) {
            console.warn(`[WSP BOT Recovery Warning] ${err.message}`);
        }
    }

    async sendMessage(target: string, message: string, retryCount = 0): Promise<void> {
        if (!this.sock) {
            console.error('[WSP BOT] Socket not initialized.');
            throw new Error('WhatsApp socket not initialized');
        }
        
        let jid = target.trim();
        if (!jid.includes('@')) {
            let cleanNumber = jid.replace(/\D/g, '');
            if (cleanNumber.length === 10) cleanNumber = '549' + cleanNumber;
            jid = cleanNumber + '@s.whatsapp.net';
        }

        try {
            await this.sock.sendMessage(jid, { text: message });
            console.log(`[WSP BOT] Message sent to ${jid}`);
        } catch (error: any) {
            if (retryCount < 2) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                return this.sendMessage(target, message, retryCount + 1);
            }
            throw error;
        }
    }

    getQR() {
        return this.qr;
    }

    async logout(): Promise<void> {
        const authFolder = process.env.AUTH_DIR || 'auth_info_baileys_bot';
        const authPath = path.resolve(process.cwd(), authFolder);
        
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners('connection.update');
                this.sock.ev.removeAllListeners('creds.update');
                this.sock.ev.removeAllListeners('messages.upsert');
                try {
                    await this.sock.logout();
                } catch {
                    this.sock.end(undefined);
                }
            } catch (e) {
                // ignore
            }
            this.sock = null;
        }

        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
    }
}

export default new BotWhatsappService();
