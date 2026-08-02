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
const groupCache = new Map<string, any>();

interface UserMessageBatch {
    messages: string[];
    timer: NodeJS.Timeout;
}
const userMessageBatches = new Map<string, UserMessageBatch>();

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

            const authFolder = process.env.AUTH_DIR || (process.env.WSP_MODE === 'bot' ? 'auth_info_baileys_bot' : 'auth_info_baileys_internal');
            const { state, saveCreds } = await useMultiFileAuthState(authFolder);
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
                getMessage: async (key: WAMessageKey): Promise<WAMessageContent | undefined> => {
                    return undefined;
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('groups.update', async ([event]) => {
                try {
                    if (this.sock && event.id) {
                        const metadata = await this.sock.groupMetadata(event.id);
                        groupCache.set(event.id, metadata);
                    }
                } catch (e) {
                    console.error('[WSP] Error updating group metadata:', e);
                }
            });

            this.sock.ev.on('group-participants.update', async (event) => {
                try {
                    if (this.sock && event.id) {
                        const metadata = await this.sock.groupMetadata(event.id);
                        groupCache.set(event.id, metadata);
                    }
                } catch (e) {
                    console.error('[WSP] Error updating group metadata on participant change:', e);
                }
            });

            this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    this.qr = qr;
                    console.log(`[WSP ${process.env.WSP_MODE || 'service'}] New QR Code generated. Scan with your WhatsApp:`);
                    qrcodeTerminal.generate(qr, { small: true });
                }
                
                if (connection === 'close') {
                    const error = lastDisconnect?.error as Boom;
                    const statusCode = error?.output?.statusCode;
                    const errorMessage = error?.message || '';
                    
                    console.log(`[WSP ${process.env.WSP_MODE || 'service'}] Connection closed. Status code: ${statusCode}. Error: ${errorMessage}`);
                    
                    this.isInitializing = false;
                    
                    // Si es un error de logout o un error crítico de cifrado
                    const isEncryptionError = errorMessage.includes('MessageCounterError') || errorMessage.includes('Key used already');
                    const isConflict = statusCode === 440 || errorMessage.includes('conflict');

                    if (statusCode === DisconnectReason.loggedOut || isEncryptionError) {
                        console.log(`[WSP ${process.env.WSP_MODE || 'service'}] Session error or logged out. Clearing credentials folder (${authFolder})...`);
                        try {
                            if (fs.existsSync(authFolder)) {
                                fs.rmSync(authFolder, { recursive: true, force: true });
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
                    console.log(`✓ [WSP ${process.env.WSP_MODE || 'service'}] WhatsApp connection established!`);
                }
            });

            // Listener de mensajes recibidos
            this.sock.ev.on('messages.upsert', async (m) => {
                const wspMode = process.env.WSP_MODE || 'bot';
                // Si la instancia es exclusivamente de notificaciones internas ('internal'), no responde conversaciones a clientes
                if (wspMode === 'internal') {
                    return;
                }

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

        // --- RESOLUCIÓN DE NÚMERO DE TELÉFONO REAL (PN) ---
        let realPhoneNumber = '';
        const rawSenderNumber = senderJid.split('@')[0];

        if (senderJid.endsWith('@s.whatsapp.net')) {
            realPhoneNumber = rawSenderNumber;
        }

        // 1. Verificar si Baileys incluyó un JID de teléfono alternativo (remoteJidAlt / participantAlt)
        const remoteJidAlt = (msg.key as any)?.remoteJidAlt || (msg.key as any)?.participantAlt || (msg as any)?.participant || '';
        if (!realPhoneNumber && remoteJidAlt && typeof remoteJidAlt === 'string' && remoteJidAlt.endsWith('@s.whatsapp.net')) {
            realPhoneNumber = remoteJidAlt.split('@')[0];
            console.log(`[WSP Phone Resolution] Resolved LID ${rawSenderNumber} via remoteJidAlt JID to PN: ${realPhoneNumber}`);
        }

        // 2. Si es un LID (@lid), buscar mapeo persistido de Baileys en la carpeta de autenticación dinámica (AUTH_DIR)
        if (!realPhoneNumber && senderJid.endsWith('@lid')) {
            console.log(`[WSP Phone Resolution] Processing LID: ${rawSenderNumber}. PushName: ${msg.pushName}`);
            const authDir = process.env.AUTH_DIR || 'auth_info_baileys_bot';
            const possibleMappingPaths = [
                path.join(process.cwd(), authDir, `lid-mapping-${rawSenderNumber}_reverse.json`),
                path.join(process.cwd(), authDir, `lid-mapping-${rawSenderNumber}.json`),
                path.join(process.cwd(), 'auth_info_baileys_bot', `lid-mapping-${rawSenderNumber}_reverse.json`),
                path.join(process.cwd(), 'auth_info_baileys_bot', `lid-mapping-${rawSenderNumber}.json`)
            ];

            for (const mappingPath of possibleMappingPaths) {
                if (fs.existsSync(mappingPath)) {
                    try {
                        const pnData = fs.readFileSync(mappingPath, 'utf8');
                        const cleaned = pnData.replace(/[^0-9]/g, '').trim();
                        if (cleaned) {
                            realPhoneNumber = cleaned;
                            console.log(`[WSP Phone Resolution] ✅ Resolved LID ${rawSenderNumber} via ${path.basename(mappingPath)} to PN: ${realPhoneNumber}`);
                            break;
                        }
                    } catch (err) {
                        console.error('[WSP Phone Resolution] Error reading LID mapping file:', err);
                    }
                }
            }
        }

        // Sanear dejando únicamente dígitos numéricos (ej. 5493437435266)
        realPhoneNumber = realPhoneNumber.replace(/\D/g, '');

        // Si falló la resolución de PN y era un LID, dejar rawSenderNumber limpio
        if (!realPhoneNumber) {
            realPhoneNumber = rawSenderNumber.replace(/\D/g, '');
        }

        const senderNumber = realPhoneNumber;
        console.log(`[WSP Access Granted] JID: ${senderJid} -> Real Phone Number: "${senderNumber}"`);

        const messageText = msg.message?.conversation || 
                          msg.message?.extendedTextMessage?.text || 
                          msg.message?.imageMessage?.caption ||
                          '';

        const isMedia = !!(msg.message?.imageMessage || msg.message?.documentMessage);
        const currentState = userStates.get(senderJid);

        // 2. Lógica del Chatbot (Desactivada la ingesta de documentos/fotos por el momento)
        if (isMedia) {
            await this.sendMessage(senderJid, "Por el momento no puedo procesar fotos ni documentos 📷. ¿Podrías escribirme el número de DNI en texto por acá así te lo consulto de una? 🚀");
            return;
        }

        // --- INTEGRACIÓN GEMINI CON BATCHING Y DEBOUNCE (30 SEGUNDOS) ---
        if (messageText.trim()) {
            const cleanText = messageText.trim();
            const existingBatch = userMessageBatches.get(senderJid);

            if (existingBatch) {
                clearTimeout(existingBatch.timer);
                existingBatch.messages.push(cleanText);
                console.log(`[WSP Batch] Mensaje adicional de ${senderNumber} agrupado (Total ráfaga: ${existingBatch.messages.length})`);
            } else {
                userMessageBatches.set(senderJid, {
                    messages: [cleanText],
                    timer: setTimeout(() => {}, 0)
                });
            }

            const currentBatch = userMessageBatches.get(senderJid)!;

            // Esperar 30 segundos tras el último mensaje de la ráfaga para responder en 1 sola llamada
            currentBatch.timer = setTimeout(async () => {
                const combinedText = currentBatch.messages.join("\n");
                userMessageBatches.delete(senderJid);

                console.log(`[WSP Batch] Procesando ráfaga combinada para ${senderNumber} (${currentBatch.messages.length} mensaje/s):\n"${combinedText}"`);

                try {
                    const latestState = userStates.get(senderJid);
                    const history = latestState?.history || [];
                    
                    const aiResponse = await geminiService.chat(combinedText, history, senderNumber);
                    
                    userStates.set(senderJid, {
                        step: 'CHATTING',
                        history: aiResponse.newHistory
                    });

                    if (aiResponse.text && aiResponse.text.trim()) {
                        await this.sendMessage(senderJid, aiResponse.text.trim());
                    }
                } catch (err: any) {
                    console.error('[WSP Error Handler] Error calling Gemini after retries:', err.message);
                    // REGLA CRÍTICA: NO ENVIAR MENSAJES DE ERROR AL CLIENTE (ej. "escribinos más tarde").
                    // Se registra silenciosamente en logs. El cliente no recibe respuestas de fallo.
                }
            }, 30000);
        }
    }

    private async checkWhitelist(number: string): Promise<boolean> {
        // Refrescar cada 5 minutos
        if (Date.now() - this.lastConfigFetch > 5 * 60 * 1000) {
            try {
                const token = process.env.BACKEND_API_KEY || "";
                console.log(`[WSP] Fetching whitelist. Token defined: ${!!token}`);
                
                const response = await axios.get(`${process.env.BACKEND_URL}/api/v1/config/whatsapp`, {
                    headers: { 'x-api-key': token }
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
     * Envía un mensaje de texto a un número o JID específico con reintentos y consulta onWhatsApp
     */
    async sendMessage(target: string, message: string, retryCount = 0): Promise<void> {
        if (!this.sock) {
            console.error('[WSP] Socket not initialized. Cannot send message.');
            throw new Error('WhatsApp socket not initialized');
        }
        
        let jid = target.trim();

        // 1. Manejo de Grupos de WhatsApp
        if (jid.includes('@g.us') || (jid.length > 15 && !jid.includes('@') && jid.startsWith('120'))) {
            if (!jid.endsWith('@g.us')) {
                jid = jid + '@g.us';
            }
        } 
        // 2. Manejo de Números Individuales
        else if (!jid.includes('@')) {
            let cleanNumber = jid.replace(/\D/g, '');
            
            // Normalización para Argentina
            if (cleanNumber.length === 10) {
                cleanNumber = '549' + cleanNumber;
            } else if (cleanNumber.startsWith('54') && !cleanNumber.startsWith('549') && cleanNumber.length === 12) {
                cleanNumber = '549' + cleanNumber.substring(2);
            } else if (cleanNumber.startsWith('0') && cleanNumber.length === 11) {
                cleanNumber = '549' + cleanNumber.substring(1);
            }

            // Consultar a WhatsApp (onWhatsApp) para obtener el JID exacto registrado en los servidores de Meta (con o sin '9')
            try {
                const results = await this.sock.onWhatsApp(cleanNumber);
                if (results && results.length > 0 && results[0]?.exists && results[0]?.jid) {
                    jid = results[0].jid;
                    console.log(`[WSP] Verified WhatsApp JID via onWhatsApp: ${jid}`);
                } else {
                    // Si no lo encuentra con '549', probar con el formato sin '9' (54...)
                    const altNumber = cleanNumber.startsWith('549') ? '54' + cleanNumber.substring(3) : cleanNumber;
                    const altResults = await this.sock.onWhatsApp(altNumber);
                    if (altResults && altResults.length > 0 && altResults[0]?.exists && altResults[0]?.jid) {
                        jid = altResults[0].jid;
                        console.log(`[WSP] Verified alt WhatsApp JID via onWhatsApp: ${jid}`);
                    } else {
                        jid = cleanNumber + '@s.whatsapp.net';
                    }
                }
            } catch (err: any) {
                console.warn(`[WSP] Could not query onWhatsApp for ${cleanNumber}:`, err.message);
                jid = cleanNumber + '@s.whatsapp.net';
            }
        }

        try {
            console.log(`[WSP] Sending message to ${jid} (Attempt ${retryCount + 1})...`);
            await this.sock.sendMessage(jid, { text: message });
            console.log(`[WSP] Message successfully handed to Baileys for ${jid}`);
        } catch (error: any) {
            const isClosed = error.message?.includes('Closed') || error.message?.includes('1006') || error.message?.includes('connection');
            
            if (isClosed && retryCount < 2) {
                console.log(`[WSP] Connection issues during send. Retrying in 3s...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                return this.sendMessage(target, message, retryCount + 1);
            }
            
            console.error(`[WSP] Failed to send message to ${jid} after retries:`, error.message);
            throw error;
        }
    }

    getQR() {
        return this.qr;
    }

    async logout(): Promise<void> {
        const authFolder = process.env.AUTH_DIR || (process.env.WSP_MODE === 'bot' ? 'auth_info_baileys_bot' : 'auth_info_baileys_internal');
        console.log(`[WSP ${process.env.WSP_MODE || 'service'}] Logging out and clearing credentials folder (${authFolder})...`);
        
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
                console.log('Error closing socket on logout:', e);
            }
            this.sock = null;
        }

        try {
            if (fs.existsSync(authFolder)) {
                fs.rmSync(authFolder, { recursive: true, force: true });
            }
        } catch (err) {
            console.error('Error clearing credentials folder on logout:', err);
        }

        this.qr = null;
        this.isInitializing = false;

        // Reiniciar socket para generar nuevo QR de inmediato
        setTimeout(() => this.init(), 1000);
    }
}

export default new WhatsappService();
