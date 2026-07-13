import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    ConnectionState,
    WASocket,
    proto,
    WAMessageContent,
    WAMessageKey,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import dotenv from 'dotenv';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import qrcodeTerminal from 'qrcode-terminal';
import geminiService from './services/gemini';

dotenv.config({ path: path.join(__dirname, '../.env') });

// Mapa para manejar el estado de los usuarios (Chatbot) y caché de mensajes procesados
const userStates = new Map<string, { step: string, mediaMessage?: any, history: any[] }>();
const processedMessages = new Set<string>();

class WhatsappService {
    public sock: WASocket | null = null;
    private qr: string | null = null;
    private allowedNumbers: string[] = [];
    private lastConfigFetch: number = 0;

    private isInitializing = false;

    async init() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            console.log('Initializing WhatsApp Service...');
            
            // Cerrar socket existente si hay uno de forma segura
            if (this.sock) {
                try {
                    this.sock.ev.removeAllListeners('connection.update');
                    this.sock.ev.removeAllListeners('creds.update');
                    this.sock.ev.removeAllListeners('messages.upsert');
                    // end() es más seguro que logout() si la conexión ya está fallida
                    this.sock.end(undefined); 
                } catch (e) {
                    console.log('Prev connection already closed');
                }
                this.sock = null;
            }

            const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
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
                getMessage: async (key: WAMessageKey): Promise<WAMessageContent | undefined> => {
                    return undefined;
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    this.qr = qr;
                    console.log('New QR Code generated. Scan with your WhatsApp:');
                    qrcodeTerminal.generate(qr, { small: true });
                }
                
                if (connection === 'close') {
                    const error = lastDisconnect?.error as Boom;
                    const statusCode = error?.output?.statusCode;
                    const errorMessage = error?.message || '';
                    
                    console.log(`Connection closed. Status code: ${statusCode}. Error: ${errorMessage}`);
                    
                    this.isInitializing = false;
                    
                    // Si es un error de logout o un error crítico de cifrado
                    const isEncryptionError = errorMessage.includes('MessageCounterError') || errorMessage.includes('Key used already');
                    const isConflict = statusCode === 440 || errorMessage.includes('conflict');

                    if (statusCode === DisconnectReason.loggedOut || isEncryptionError) {
                        console.log('Session error or logged out. Clearing credentials...');
                        try {
                            if (fs.existsSync('auth_info_baileys')) {
                                fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                            }
                        } catch (err) {
                            console.error('Error clearing credentials folder:', err);
                        }
                        setTimeout(() => this.init(), 2000);
                    } else if (isConflict) {
                        console.log('Stream conflict detected. Waiting 10s before reconnecting...');
                        setTimeout(() => this.init(), 10000);
                    } else {
                        // Reintentar con un delay mayor para evitar bucles infinitos
                        console.log('Reconnecting in 5 seconds...');
                        setTimeout(() => this.init(), 5000);
                    }
                } else if (connection === 'open') {
                    this.qr = null;
                    this.isInitializing = false;
                    console.log('✓ WhatsApp connection established!');
                }
            });

            // Listener de mensajes recibidos
            this.sock.ev.on('messages.upsert', async (m) => {
                if (m.type === 'notify') {
                    for (const msg of m.messages) {
                        if (!msg.key.fromMe) {
                            await this.handleIncomingMessage(msg);
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error during WhatsApp init:', error);
            this.isInitializing = false;
            setTimeout(() => this.init(), 10000);
        }
    }

    private decodeJid(jid: string): string {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decode = jid.split(':');
            if (decode.length > 1) {
                return `${decode[0]}@${decode[1].split('@')[1]}`;
            }
        }
        return jid;
    }

    private async handleIncomingMessage(msg: proto.IWebMessageInfo) {
        if (!msg.key?.remoteJid || !msg.key?.id) return;

        const messageId = msg.key.id;
        if (processedMessages.has(messageId)) {
            console.log(`[WSP] Message ${messageId} already processed, skipping.`);
            return;
        }
        processedMessages.add(messageId);
        if (processedMessages.size > 500) {
            const firstVal = processedMessages.values().next().value;
            if (firstVal !== undefined) {
                processedMessages.delete(firstVal);
            }
        }

        const rawJid = msg.key.remoteJid;
        const senderJid = this.decodeJid(rawJid);
        
        // Solo procesar chats individuales
        if (!senderJid.endsWith('@s.whatsapp.net') && !senderJid.endsWith('@lid')) {
            return;
        }

        // Identificadores para la whitelist
        const senderNumber = senderJid.split('@')[0];
        
        // Intentar obtener el número de teléfono real (PN) si es un LID usando el mapeo de Baileys
        let alternativePn = '';
        if (senderJid.endsWith('@lid')) {
            console.log(`[WSP] Processing LID: ${senderNumber}. PushName: ${msg.pushName}`);
            try {
                const mappingPath = path.join(process.cwd(), 'auth_info_baileys', `lid-mapping-${senderNumber}_reverse.json`);
                if (fs.existsSync(mappingPath)) {
                    const pnData = fs.readFileSync(mappingPath, 'utf8');
                    // Baileys lo guarda con comillas: "54911223344"
                    alternativePn = pnData.replace(/"/g, '').trim();
                    console.log(`[WSP] Resolved LID to PN: ${alternativePn}`);
                }
            } catch (err) {
                console.error('[WSP] Error resolving LID to PN:', err);
            }
        }

        // 1. Verificar Lista Blanca (DESACTIVADO TEMPORALMENTE PARA PRUEBAS)
        /*
        const isAllowedDirect = await this.checkWhitelist(senderNumber);
        const isAllowedAlternative = alternativePn ? await this.checkWhitelist(alternativePn) : false;
        
        if (!isAllowedDirect && !isAllowedAlternative) {
            console.log(`[WSP] Access denied for: ${senderNumber} (PN: ${alternativePn || 'N/A'})`);
            return;
        }
        */

        console.log(`[WSP] Access granted (Whitelist bypassed) for: ${senderNumber} (PN: ${alternativePn || 'N/A'})`);

        const messageText = msg.message?.conversation || 
                          msg.message?.extendedTextMessage?.text || 
                          msg.message?.imageMessage?.caption ||
                          '';

        const isMedia = !!(msg.message?.imageMessage || msg.message?.documentMessage);
        const currentState = userStates.get(senderJid);

        // 2. Lógica del Chatbot
        if (isMedia) {
            // Recibió una imagen o documento
            userStates.set(senderJid, { 
                step: 'AWAITING_ACTION', 
                mediaMessage: msg,
                history: currentState?.history || []
            });
            await this.sendMessage(senderJid, "He recibido un archivo. ¿Deseas guardarlo en la Gestión Documental?\n\n*Responde con el número 1 para confirmar.*");
            return;
        }

        if (currentState?.step === 'AWAITING_ACTION' && messageText.trim() === '1') {
            await this.sendMessage(senderJid, "⏳ Procesando archivo, por favor espera...");
            try {
                const success = await this.processAndUploadMedia(currentState.mediaMessage);
                if (success) {
                    await this.sendMessage(senderJid, "✅ ¡Documento guardado exitosamente en la Gestión Documental!");
                } else {
                    await this.sendMessage(senderJid, "❌ Hubo un error al procesar el documento. Intenta nuevamente.");
                }
            } catch (err) {
                console.error('Error in chatbot flow:', err);
                await this.sendMessage(senderJid, "❌ Error crítico al subir el archivo.");
            } finally {
                userStates.delete(senderJid);
            }
            return;
        }

        // --- INTEGRACIÓN GEMINI ---
        if (messageText.trim()) {
            try {
                // Delay de 5 segundos para simular respuesta humana y estabilizar conexión
                await new Promise(resolve => setTimeout(resolve, 5000));

                const history = currentState?.history || [];
                const aiResponse = await geminiService.chat(messageText, history);
                
                userStates.set(senderJid, {
                    step: 'CHATTING',
                    history: aiResponse.newHistory
                });

                if (aiResponse.text) {
                    await this.sendMessage(senderJid, aiResponse.text);
                }
            } catch (err: any) {
                console.error('[WSP] Error calling Gemini:', err.message);
                
                // Si es un error de sobrecarga (503), intentamos dar un mensaje más amigable
                if (err.message?.includes('503') || err.message?.includes('high demand')) {
                    await this.sendMessage(senderJid, "Estoy recibiendo muchas consultas en este momento. ¿Podrías intentar escribirme de nuevo en unos segundos?");
                } else {
                    await this.sendMessage(senderJid, "Lo siento, tuve un problema al procesar tu mensaje. ¿Podrías repetirlo?");
                }
            }
        }
    }

    private async checkWhitelist(number: string): Promise<boolean> {
        // Refrescar cada 5 minutos
        if (Date.now() - this.lastConfigFetch > 5 * 60 * 1000) {
            try {
                const token = process.env.WSP_AUTH_CODE;
                console.log(`[WSP] Fetching whitelist. Token defined: ${!!token}`);
                
                const response = await axios.get(`${process.env.BACKEND_URL}/api/v1/config/whatsapp`, {
                    headers: { 'x-wsp-auth-code': token }
                });
                this.allowedNumbers = response.data.allowed_numbers || [];
                console.log(`[WSP] Whitelist refreshed. Count: ${this.allowedNumbers.length}`);
                console.log(`[WSP] Allowed Numbers Array:`, JSON.stringify(this.allowedNumbers));
                this.lastConfigFetch = Date.now();
            } catch (err: any) {
                console.error('Error fetching whitelist from backend:', err.response?.data || err.message);
                if (err.response?.status === 401) {
                    console.error('[WSP] AUTH ERROR: The x-wsp-auth-code does not match backend configuration.');
                }
            }
        }
        
        const isAllowed = this.allowedNumbers.includes(number);
        console.log(`[WSP] Checking if "${number}" is in [${this.allowedNumbers.join(', ')}]: ${isAllowed}`);
        return isAllowed;
    }

    private async processAndUploadMedia(msg: proto.IWebMessageInfo): Promise<boolean> {
        try {
            const buffer = await downloadMediaMessage(msg as any, 'buffer', {});
            
            const fileName = msg.message?.imageMessage?.caption || 
                           msg.message?.documentMessage?.fileName || 
                           `wsp_doc_${Date.now()}.jpg`;
            
            const mimeType = msg.message?.imageMessage?.mimetype || 
                           msg.message?.documentMessage?.mimetype || 
                           'image/jpeg';

            const form = new FormData();
            form.append('file', buffer, { filename: fileName, contentType: mimeType });
            form.append('titulo', fileName);

            const response = await axios.post(`${process.env.BACKEND_URL}/api/v1/documents/bot-upload`, form, {
                headers: {
                    ...form.getHeaders(),
                    'x-wsp-auth-code': process.env.WSP_AUTH_CODE
                }
            });

            return response.status === 201;
        } catch (err) {
            console.error('Error uploading media to backend:', err);
            return false;
        }
    }

    /**
     * Envía un mensaje de texto a un número o JID específico con reintentos
     */
    async sendMessage(target: string, message: string, retryCount = 0): Promise<void> {
        if (!this.sock) {
            console.error('[WSP] Socket not initialized. Cannot send message.');
            return;
        }
        
        let jid = target;
        if (!jid.includes('@')) {
            let cleanNumber = jid.replace(/\D/g, '');
            // Formatear números de Argentina de forma robusta para WhatsApp
            if (cleanNumber.length === 10) {
                // E.g. 3424305393 -> 5493424305393
                cleanNumber = '549' + cleanNumber;
            } else if (cleanNumber.startsWith('54') && !cleanNumber.startsWith('549') && cleanNumber.length === 12) {
                // E.g. 543424305393 -> 5493424305393
                cleanNumber = '549' + cleanNumber.substring(2);
            } else if (cleanNumber.startsWith('0') && cleanNumber.length === 11) {
                // E.g. 03424305393 -> 5493424305393
                cleanNumber = '549' + cleanNumber.substring(1);
            }
            jid = cleanNumber + '@s.whatsapp.net';
        }

        try {
            console.log(`[WSP] Sending message to ${jid} (Attempt ${retryCount + 1})...`);
            await this.sock.sendMessage(jid, { text: message });
            console.log(`[WSP] Message successfully handed to Baileys for ${jid}`);
        } catch (error: any) {
            const isClosed = error.message?.includes('Closed') || error.message?.includes('1006');
            
            if (isClosed && retryCount < 2) {
                console.log(`[WSP] Connection closed during send. Retrying in 3s...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                return this.sendMessage(target, message, retryCount + 1);
            }
            
            console.error(`[WSP] Failed to send message to ${jid} after retries:`, error.message);
        }
    }

    getQR() {
        return this.qr;
    }
}

export default new WhatsappService();
