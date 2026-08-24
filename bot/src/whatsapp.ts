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

const BOT_BOOT_TIME = Date.now();
const groupCache = new Map<string, any>();
const userStates = new Map<string, { step: string; history: any[]; lastActivity?: number }>();
const userMessageBatches = new Map<string, { messages: string[]; timer: NodeJS.Timeout; msgObj: any; senderJid: string; senderNumber: string }>();
const userQueues = new Map<string, { messages: string[]; msgObj: any; senderJid: string; senderNumber: string }>();

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
    private cronTimer: NodeJS.Timeout | null = null;
    private processingUsers = new Set<string>();

    async init() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            console.log('[WSP BOT] Initializing Commercial AI Bot Service...');
            
            // Limpieza proactiva de pendientes antiguos (> 2 días) antes de abrir socket y escuchar mensajes
            try {
                await this.cleanupStalePendingConversations(2);
            } catch (cleanErr: any) {
                console.warn(`[WSP BOT Init Clean Error]: ${cleanErr.message}`);
            }

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
                    
                    // 1. Limpiar chats pendientes con más de 2 días ANTES de procesar o recuperar respuestas
                    this.cleanupStalePendingConversations(2).then(() => {
                        setTimeout(() => this.recoverPendingConversations(), 5000);
                    }).catch(() => {
                        setTimeout(() => this.recoverPendingConversations(), 5000);
                    });

                    if (!this.cronTimer) {
                        console.log(`[WSP BOT Cron] 🕒 Programando cron de recuperación cada 10 minutos para responder mensajes pendientes.`);
                        this.cronTimer = setInterval(() => {
                            console.log(`[WSP BOT Cron] 🕒 Ejecutando revisión periódica de mensajes pendientes no atendidos...`);
                            this.recoverPendingConversations();
                        }, 10 * 60 * 1000);
                    }
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

                    // Resolver timestamp real del mensaje de Baileys
                    const rawTimestamp = msg.messageTimestamp;
                    let msgTimestamp = Date.now();
                    if (rawTimestamp) {
                        if (typeof rawTimestamp === 'number') {
                            msgTimestamp = rawTimestamp > 1e11 ? rawTimestamp : rawTimestamp * 1000;
                        } else if (typeof (rawTimestamp as any)?.low === 'number') {
                            msgTimestamp = (rawTimestamp as any).low * 1000;
                        } else if (typeof (rawTimestamp as any)?.toNumber === 'function') {
                            msgTimestamp = (rawTimestamp as any).toNumber() * 1000;
                        } else {
                            const num = Number(rawTimestamp);
                            if (!isNaN(num) && num > 0) {
                                msgTimestamp = num > 1e11 ? num : num * 1000;
                            }
                        }
                    }

                    const msgAgeMs = Date.now() - msgTimestamp;
                    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

                    // 1. Descartar mensajes con más de 2 días de antigüedad
                    if (msgAgeMs >= TWO_DAYS_MS) {
                        const daysOld = (msgAgeMs / (1000 * 60 * 60 * 24)).toFixed(1);
                        console.log(`[WSP BOT Upsert] ⏭️ Mensaje de ${senderNumber} recibido con ${daysOld} días de antigüedad (>= 2 días). Sincronizado como ATENDIDO para no responder.`);
                        try {
                            const backendUrl = this.getCleanBackendUrl();
                            const apiKey = getApiKey();
                            await axios.post(`${backendUrl}/api/v1/crm/chat/sync`, {
                                jid: senderJid,
                                phone: senderNumber,
                                pushName: msg.pushName || "",
                                lastMessage: textMessage,
                                replyStatus: 'ATENDIDO',
                                status: 'CLOSED',
                                closeReason: 'INACTIVITY',
                                updatedAt: new Date(msgTimestamp)
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 10000
                            });
                        } catch (syncErr: any) {}
                        continue;
                    }

                    // 2. ESCUDO ANTI-REPETICIÓN POR RECONEXIÓN:
                    // Si el mensaje fue enviado antes de que arrancara esta instancia del bot (con 15s de margen),
                    // es un replay/historial recibido por reconexión del socket de WhatsApp. Sincronizar como ATENDIDO y no responder.
                    if (msgTimestamp < (BOT_BOOT_TIME - 15000)) {
                        console.log(`[WSP BOT Replay Guard] ⏭️ Mensaje de ${senderNumber} recibido en reconexión (${new Date(msgTimestamp).toLocaleString('es-AR')}) es previo al inicio del bot. Sincronizando como ATENDIDO para no responder.`);
                        try {
                            const backendUrl = this.getCleanBackendUrl();
                            const apiKey = getApiKey();
                            await axios.post(`${backendUrl}/api/v1/crm/chat/sync`, {
                                jid: senderJid,
                                phone: senderNumber,
                                pushName: msg.pushName || "",
                                lastMessage: textMessage,
                                replyStatus: 'ATENDIDO',
                                updatedAt: new Date(msgTimestamp)
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 10000
                            });
                        } catch (syncErr: any) {}
                        continue;
                    }

                    // Sincronizar inmediatamente a DB con estado PENDIENTE apenas ingresa el mensaje (sin lastMessage prematuro)
                    try {
                        const backendUrl = this.getCleanBackendUrl();
                        const apiKey = getApiKey();
                        await axios.post(`${backendUrl}/api/v1/crm/chat/sync`, {
                            jid: senderJid,
                            phone: senderNumber,
                            pushName: msg.pushName || "",
                            replyStatus: 'PENDIENTE',
                            updatedAt: new Date()
                        }, {
                            headers: { 'x-api-key': apiKey },
                            timeout: 15000
                        });
                        console.log(`[WSP BOT Sync] 🟢 Mensaje de ${senderNumber} registrado inmediatamente en DB con estado PENDIENTE`);
                    } catch (syncErr: any) {
                        // ignore non-critical sync errors
                    }

                    // Identificador único de usuario (unificando teléfono numérico y JID para evitar colisiones entre @lid y @s.whatsapp.net)
                    const userKey = (senderNumber || senderJid).trim();

                    // Si ya existe un procesamiento activo (Gemini generando respuesta o enviando) para este usuario:
                    if (this.processingUsers.has(userKey) || this.processingUsers.has(senderJid) || (senderNumber && this.processingUsers.has(senderNumber))) {
                        console.log(`[WSP BOT Queue] ⏳ Usuario ${userKey} ocupado procesando respuesta. Encolando mensaje: "${textMessage.trim()}"`);
                        const q = userQueues.get(userKey) || { messages: [], msgObj: msg, senderJid, senderNumber };
                        q.messages.push(textMessage.trim());
                        q.msgObj = msg;
                        userQueues.set(userKey, q);
                        continue;
                    }

                    // Agrupación ráfaga inteligente (Debounce dinámico 15s a 30s reseteado a partir del último mensaje recibido)
                    const computeBatchDelay = () => Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;

                    const existingBatch = userMessageBatches.get(userKey);
                    if (existingBatch) {
                        if (existingBatch.timer) clearTimeout(existingBatch.timer);
                        existingBatch.messages.push(textMessage.trim());
                        existingBatch.msgObj = msg;
                        const batchDelay = computeBatchDelay();
                        console.log(`[WSP BOT Batch] 🔄 Nuevo mensaje de ${userKey}. Ráfaga reseteada a ${(batchDelay / 1000).toFixed(1)}s (Total mensajes acumulados: ${existingBatch.messages.length}): "${textMessage.trim()}"`);
                        
                        existingBatch.timer = setTimeout(async () => {
                            const current = userMessageBatches.get(userKey);
                            if (!current) return;
                            const uniqueMsgs = Array.from(new Set(current.messages.map(m => m.trim()).filter(Boolean)));
                            const fullText = uniqueMsgs.join('\n');
                            const finalMsgObj = current.msgObj;
                            const finalJid = current.senderJid;
                            const finalNumber = current.senderNumber;
                            userMessageBatches.delete(userKey);
                            await this.processUserMessage(userKey, finalJid, finalNumber, fullText, finalMsgObj);
                        }, batchDelay);
                    } else {
                        const batchDelay = computeBatchDelay();
                        console.log(`[WSP BOT Batch] 🕒 Iniciando ráfaga de ${(batchDelay / 1000).toFixed(1)}s para ${userKey}: "${textMessage.trim()}"`);
                        const timer = setTimeout(async () => {
                            const current = userMessageBatches.get(userKey);
                            if (current) {
                                const uniqueMsgs = Array.from(new Set(current.messages.map(m => m.trim()).filter(Boolean)));
                                const fullText = uniqueMsgs.join('\n');
                                const finalMsgObj = current.msgObj;
                                const finalJid = current.senderJid;
                                const finalNumber = current.senderNumber;
                                userMessageBatches.delete(userKey);
                                await this.processUserMessage(userKey, finalJid, finalNumber, fullText, finalMsgObj);
                            }
                        }, batchDelay);

                        userMessageBatches.set(userKey, {
                            messages: [textMessage.trim()],
                            timer,
                            msgObj: msg,
                            senderJid,
                            senderNumber
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

    private async processUserMessage(userKey: string, senderJid: string, senderNumber: string, combinedText: string, msg: any) {
        if (this.processingUsers.has(userKey) || this.processingUsers.has(senderJid) || (senderNumber && this.processingUsers.has(senderNumber))) {
            console.log(`[WSP BOT Guard] ⚠️ Ya existe un procesamiento activo para ${userKey}. Encolando.`);
            const q = userQueues.get(userKey) || { messages: [], msgObj: msg, senderJid, senderNumber };
            q.messages.push(combinedText);
            userQueues.set(userKey, q);
            return;
        }

        this.processingUsers.add(userKey);
        this.processingUsers.add(senderJid);
        if (senderNumber) this.processingUsers.add(senderNumber);

        try {
            await this.handleIncomingMessage(senderJid, senderNumber, combinedText, msg);
        } finally {
            this.processingUsers.delete(userKey);
            this.processingUsers.delete(senderJid);
            if (senderNumber) this.processingUsers.delete(senderNumber);

            // Desencolar y responder mensajes acumulados mientras el bot estaba generando la respuesta
            const queued = userQueues.get(userKey);
            if (queued && queued.messages.length > 0) {
                userQueues.delete(userKey);
                const uniqueQueued = Array.from(new Set(queued.messages.map(m => m.trim()).filter(Boolean)));
                const queuedText = uniqueQueued.join('\n');
                console.log(`[WSP BOT Queue Flush] 🚀 Procesando ${queued.messages.length} mensaje(s) acumulado(s) en cola para ${userKey}: "${queuedText}"`);
                setTimeout(() => {
                    this.processUserMessage(userKey, queued.senderJid, queued.senderNumber, queuedText, queued.msgObj);
                }, 1000);
            }
        }
    }

    private async handleIncomingMessage(senderJid: string, senderNumber: string, combinedText: string, msg: any) {
        try {
            const backendUrl = this.getCleanBackendUrl();
            const apiKey = getApiKey();
            let leadProfile: any = null;
            let conversationId: string | undefined = undefined;
            let leadContextText = "";

            // 1. Obtener perfil del Lead y sesión activa desde DB
            try {
                const queryTargets = [senderJid, senderNumber].filter(Boolean);
                for (const target of queryTargets) {
                    try {
                        const activeRes = await axios.get(`${backendUrl}/api/v1/crm/conversation/active/${encodeURIComponent(target)}`, {
                            headers: { 'x-api-key': apiKey },
                            timeout: 15000
                        });
                        if (activeRes.data && activeRes.data.data) {
                            if (activeRes.data.data.lead) {
                                leadProfile = activeRes.data.data.lead;
                            }
                            if (activeRes.data.data.conversation) {
                                conversationId = activeRes.data.data.conversation.conversationId;
                            }
                            if (leadProfile) break;
                        }
                    } catch (targetErr: any) {
                        console.warn(`[WSP BOT LeadProfile Warning] Error consultando target ${target}: ${targetErr.message}`);
                    }
                }

                if (conversationId) {
                    try {
                        const ctxRes = await axios.get(`${backendUrl}/api/v1/crm/conversation/active-context/${encodeURIComponent(conversationId)}?phone=${encodeURIComponent(senderNumber)}`, {
                            headers: { 'x-api-key': apiKey },
                            timeout: 15000
                        });
                        if (ctxRes.data && ctxRes.data.data && ctxRes.data.data.contextText) {
                            leadContextText = ctxRes.data.data.contextText;
                            console.log(`[WSP BOT LeadContext] 🟢 Contexto de lead activo cargado:\n${leadContextText}`);
                        }
                    } catch (ctxErr: any) {
                        console.warn(`[WSP BOT LeadContext Warning] Error consultando contexto para ${conversationId}: ${ctxErr.message}`);
                    }
                }

                if (leadProfile) {
                    console.log(`[WSP BOT LeadProfile] 🟢 Ficha de perfil inyectada para ${senderJid} (${senderNumber}):`, JSON.stringify(leadProfile));
                } else {
                    console.log(`[WSP BOT LeadProfile] ⚠️ Sin ficha previa devuelta desde DB para ${senderJid} (${senderNumber})`);
                }
            } catch (e: any) {
                console.error(`[WSP BOT LeadProfile Error] ❌ Error general obteniendo perfil para ${senderJid}: ${e.message}`);
            }

            let state = userStates.get(senderJid);

            // Hidratar historial desde backend si no existe en RAM
            if (!state || !state.history || state.history.length === 0) {
                let loadedHistory: any[] = [];
                try {
                    const chatRes = await axios.get(`${backendUrl}/api/v1/crm/chats/${encodeURIComponent(senderJid)}`, {
                        headers: { 'x-api-key': apiKey },
                        timeout: 15000
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
            const latestClientMsg = (combinedText.split('\n').pop() || combinedText).trim();
            try {
                await axios.post(syncUrl, {
                    jid: senderJid,
                    phone: senderNumber,
                    pushName: msg.pushName || "",
                    conversationId,
                    replyStatus: 'PENDIENTE',
                    lastMessage: latestClientMsg,
                    updatedAt: new Date()
                }, {
                    headers: { 'x-api-key': apiKey },
                    timeout: 15000
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

            // Detección de indicios de cierre de conversación o respuestas negativas concluyentes
            const isGoodbyeSignal = (text: string): boolean => {
                const cleaned = text.trim().toLowerCase().replace(/[^\w\s]/gi, '').trim();
                const exactNegatives = ['no', 'nop', 'nada', 'ninguna', 'ninguno', 'listo', 'ya esta', 'ya esta gracias', 'por ahora no', 'nada mas', 'no gracias', 'no por ahora', 'no nada mas', 'ninguna duda', 'todo claro', 'perfecto gracias', 'chau', 'chau gracias', 'muchas gracias chau', 'hasta luego', 'hablamos mañana', 'hasta mañana', 'nos vemos'];
                if (exactNegatives.includes(cleaned)) return true;
                const goodbyeWords = ['hablamos mañana', 'hasta mañana', 'nos vemos mañana', 'chau', 'chau gracias', 'muchas gracias chau', 'nada mas', 'nada más', 'no necesito nada mas', 'no por ahora', 'por ahora nada', 'no gracias'];
                return goodbyeWords.some(w => cleaned.includes(w));
            };
            const isClosedSession = isGoodbyeSignal(combinedText);

            const lastHistoryMsg = history.length > 0 ? history[history.length - 1] : null;
            const lastBotText = lastHistoryMsg && lastHistoryMsg.role === 'model' ? (lastHistoryMsg.parts?.[0]?.text || '').toLowerCase() : '';

            // REGLA CRÍTICA ANTI-DUPLICADOS: Si el último mensaje del historial ya fue del bot ('model'),
            // y el texto entrante ya existía previamente en el historial, descartar de inmediato para no repetir respuestas.
            if (lastHistoryMsg && lastHistoryMsg.role === 'model') {
                const cleanIncoming = combinedText.trim().toLowerCase();
                const wasAlreadyInHistory = history.some(h => {
                    const hText = (h.text || h.parts?.[0]?.text || '').toString().trim().toLowerCase();
                    return h.role === 'user' && (hText === cleanIncoming || cleanIncoming.includes(hText) || hText.includes(cleanIncoming));
                });
                if (wasAlreadyInHistory) {
                    console.log(`[WSP BOT Guard] ⏭️ El mensaje de ${senderNumber} ("${combinedText}") ya fue respondido previamente en el historial. Silenciando y sincronizando.`);
                    try {
                        await axios.post(syncUrl, {
                            jid: senderJid,
                            phone: senderNumber,
                            pushName: msg.pushName || "",
                            conversationId,
                            replyStatus: isClosedSession ? 'ATENDIDO' : 'PENDIENTE',
                            status: isClosedSession ? 'CLOSED' : 'ACTIVE',
                            closeReason: isClosedSession ? 'USER_GOODBYE' : undefined,
                            updatedAt: new Date()
                        }, {
                            headers: { 'x-api-key': apiKey },
                            timeout: 15000
                        });
                    } catch (e) {}
                    return;
                }
            }

            if (isOnlyCourtesyOrEmoji(combinedText) && (lastBotText.includes('de nada') || lastBotText.includes('que tengas') || lastBotText.includes('cualquier duda') || /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]*$/u.test(lastBotText))) {
                console.log(`[WSP BOT Courtesy Cutoff] Bucle de cortesía/emoji detectado para ${senderNumber}. Silenciando respuesta, cerrando sesión y marcando ATENDIDO en DB.`);
                try {
                    await axios.post(syncUrl, {
                        jid: senderJid,
                        phone: senderNumber,
                        pushName: msg.pushName || "",
                        conversationId,
                        replyStatus: 'ATENDIDO',
                        status: 'CLOSED',
                        closeReason: 'USER_GOODBYE',
                        updatedAt: new Date()
                    }, {
                        headers: { 'x-api-key': apiKey },
                        timeout: 15000
                    });
                } catch (cErr: any) {
                    console.error(`[WSP BOT Courtesy Sync Error]: ${cErr.message}`);
                }
                return;
            }

            // 3. Generar respuesta de Gemini e inyectar perfil del cliente y lead activo
            let aiResponse: any;
            try {
                aiResponse = await geminiService.chat(combinedText, history, senderNumber, senderJid, leadProfile, conversationId, leadContextText);

                userStates.set(senderJid, {
                    step: 'CHATTING',
                    history: aiResponse.newHistory,
                    lastActivity: Date.now()
                });

                if (aiResponse.text && aiResponse.text.trim()) {
                    // Retardo aleatorio humano dinámico entre 15s y 30s
                    const minDelay = 15000;
                    const maxDelay = 30000;
                    const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                    const delaySeconds = (randomDelay / 1000).toFixed(1);
                    console.log(`[WSP BOT Delay] Espera humana de ${delaySeconds}s antes de enviar respuesta a ${senderNumber}...`);
                    
                    // Activar presencia "Escribiendo..." en WhatsApp
                    if (this.sock) {
                        try {
                            await this.sock.sendPresenceUpdate('composing', senderJid);
                        } catch (presErr) {}
                    }

                    await new Promise(resolve => setTimeout(resolve, randomDelay));
                    
                    // Enviar mensaje por socket de WhatsApp
                    await this.sendMessage(senderJid, aiResponse.text.trim());

                    // Desactivar presencia "Escribiendo..."
                    if (this.sock) {
                        try {
                            await this.sock.sendPresenceUpdate('paused', senderJid);
                        } catch (presErr) {}
                    }
                    
                    // 4. ÚNICAMENTE TRAS ENVIAR EL MENSAJE CON ÉXITO: Sincronizar en DB
                    // REGLA: ATENDIDO = conversaciones cerradas / concluidas. PENDIENTE = conversación en curso activa.
                    const syncPayload = {
                        jid: senderJid,
                        phone: senderNumber,
                        pushName: msg.pushName || "",
                        conversationId,
                        history: aiResponse.newHistory,
                        lastMessage: aiResponse.text.trim() || latestClientMsg,
                        replyStatus: isClosedSession ? 'ATENDIDO' : 'PENDIENTE',
                        status: isClosedSession ? 'CLOSED' : 'ACTIVE',
                        closeReason: isClosedSession ? 'USER_GOODBYE' : undefined,
                        updatedAt: new Date()
                    };

                    await axios.post(syncUrl, syncPayload, {
                        headers: { 'x-api-key': apiKey },
                        timeout: 15000
                    });
                } else {
                    console.warn(`[WSP BOT Warning] Gemini devolvió respuesta vacía para ${senderNumber}. Se mantiene estado PENDIENTE.`);
                }

            } catch (responseErr: any) {
                console.error(`[WSP BOT Error] Falló el procesamiento o envío de respuesta para ${senderNumber}: ${responseErr.message}. La conversación SE MANTIENE PENDIENTE en DB.`);
                
                // Asegurar resiliencia: actualizar estado PENDIENTE en DB
                try {
                    await axios.post(syncUrl, {
                        jid: senderJid,
                        phone: senderNumber,
                        pushName: msg.pushName || "",
                        conversationId,
                        history: history,
                        lastMessage: combinedText,
                        replyStatus: 'PENDIENTE',
                        status: 'ACTIVE',
                        updatedAt: new Date()
                    }, {
                        headers: { 'x-api-key': apiKey },
                        timeout: 15000
                    });
                } catch (syncErr: any) {
                    console.error(`[WSP BOT Sync Fallback Error] (${syncUrl}): ${syncErr.message}`);
                }
            }

        } catch (error: any) {
            console.error(`[WSP BOT Error] Error general procesando mensaje de ${senderNumber}:`, error);
        }
    }

    public async cleanupStalePendingConversations(maxDays: number = 2): Promise<number> {
        const backendUrl = this.getCleanBackendUrl();
        const apiKey = getApiKey();
        const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;
        const now = Date.now();

        console.log(`[WSP BOT Init Clean] 🧹 Verificando chats pendientes al iniciar: pasando a ATENDIDO si tienen >${maxDays} días o si su último mensaje ya es del bot...`);

        // 1. Intentar endpoint dedicado masivo en backend
        try {
            const cleanRes = await axios.post(`${backendUrl}/api/v1/crm/conversations/cleanup-stale`, { maxDays }, {
                headers: { 'x-api-key': apiKey },
                timeout: 10000
            });
            if (cleanRes.data && typeof cleanRes.data.count === 'number') {
                console.log(`[WSP BOT Init Clean] ✅ Limpieza masiva en backend: ${cleanRes.data.count} conversación(es) antigua(s) pasada(s) a ATENDIDO.`);
                return cleanRes.data.count;
            }
        } catch (e: any) {
            // Fallback por lista si el backend no cuenta con el endpoint actualizado
        }

        // 2. Fallback: Traer pendientes y limpiar individualmente
        let cleanedCount = 0;
        try {
            const res = await axios.get(`${backendUrl}/api/v1/crm/conversation/pending`, {
                headers: { 'x-api-key': apiKey },
                timeout: 15000
            });
            const list = res.data?.conversations;
            if (Array.isArray(list) && list.length > 0) {
                for (const conv of list) {
                    const messages = conv.messages || conv.history || [];
                    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

                    // REGLA CRÍTICA: Si el último mensaje es del bot ('model'), NO está pendiente. Marcar como ATENDIDO de inmediato.
                    if (lastMsg && lastMsg.role === 'model') {
                        cleanedCount++;
                        console.log(`[WSP BOT Init Clean] ⏭️ Conversación de ${conv.phone || conv.jid} ya tiene respuesta del bot como último mensaje. Marcando ATENDIDO en DB.`);
                        try {
                            await axios.post(`${backendUrl}/api/v1/crm/chat/sync`, {
                                jid: conv.jid,
                                phone: conv.phone,
                                conversationId: conv.conversationId,
                                replyStatus: 'ATENDIDO',
                                updatedAt: new Date()
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 10000
                            });
                        } catch (err: any) {
                            console.warn(`[WSP BOT Init Clean Error] Error marcando atendido a ${conv.phone}: ${err.message}`);
                        }
                        continue;
                    }

                    const lastTime = conv.lastMessageAt || conv.updatedAt || conv.createdAt;
                    const ageMs = lastTime ? (now - new Date(lastTime).getTime()) : (maxAgeMs + 1);
                    
                    if (ageMs >= maxAgeMs) {
                        cleanedCount++;
                        const ageDays = (ageMs / (1000 * 60 * 60 * 24)).toFixed(1);
                        console.log(`[WSP BOT Init Clean] ⏭️ Conversación de ${conv.phone || conv.jid} tiene ${ageDays} días de inactividad (>= ${maxDays} días). Marcando ATENDIDO para no responder.`);
                        try {
                            await axios.post(`${backendUrl}/api/v1/crm/chat/sync`, {
                                jid: conv.jid,
                                phone: conv.phone,
                                conversationId: conv.conversationId,
                                replyStatus: 'ATENDIDO',
                                status: 'CLOSED',
                                closeReason: 'INACTIVITY',
                                updatedAt: new Date()
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 10000
                            });
                        } catch (err: any) {
                            console.warn(`[WSP BOT Init Clean Error] Error marcando atendido a ${conv.phone}: ${err.message}`);
                        }
                    }
                }
                console.log(`[WSP BOT Init Clean] ✅ Limpieza individual finalizada. ${cleanedCount} conversación(es) pasada(s) a ATENDIDO.`);
            } else {
                console.log(`[WSP BOT Init Clean] ✅ No se encontraron conversaciones pendientes antiguas.`);
            }
        } catch (err: any) {
            console.warn(`[WSP BOT Init Clean Warning] Error verificando pendientes: ${err.message}`);
        }
        return cleanedCount;
    }

    public async recoverPendingConversations(): Promise<void> {
        const backendUrl = this.getCleanBackendUrl();
        const apiKey = getApiKey();
        try {
            console.log(`[WSP BOT Recovery] Verificando mensajes pendientes de respuesta en DB...`);
            const res = await axios.get(`${backendUrl}/api/v1/crm/conversation/pending`, {
                headers: { 'x-api-key': apiKey },
                timeout: 15000
            });
            const list = res.data?.conversations;
            if (Array.isArray(list) && list.length > 0) {
                console.log(`[WSP BOT Recovery] Se encontraron ${list.length} conversación(es) pendiente(s) de respuesta. Procesando...`);
                for (const conv of list) {
                    if (this.processingUsers.has(conv.jid) || (conv.phone && this.processingUsers.has(conv.phone))) {
                        console.log(`[WSP BOT Recovery] Omitiendo ${conv.phone || conv.jid} porque ya cuenta con una respuesta en proceso en memoria.`);
                        continue;
                    }

                    const lastTime = conv.updatedAt || conv.lastMessageAt || conv.createdAt;
                    const elapsedMs = lastTime ? (Date.now() - new Date(lastTime).getTime()) : 999999;

                    if (elapsedMs < 60000 && userMessageBatches.has(conv.jid)) {
                        console.log(`[WSP BOT Recovery] Omitiendo ${conv.phone} porque se encuentra activamente en ventana de espera (${Math.round(elapsedMs / 1000)}s).`);
                        continue;
                    }

                    const messages = conv.messages || conv.history || [];
                    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

                    // Si el último mensaje es del bot, no hay nada pendiente de responder
                    if (lastMsg && lastMsg.role === 'model') {
                        console.log(`[WSP BOT Recovery] Conversación de ${conv.phone || conv.jid} ya tiene respuesta del bot como último mensaje. Marcando ATENDIDO en DB.`);
                        try {
                            await axios.post(`${backendUrl}/api/v1/crm/chat/sync`, {
                                jid: conv.jid,
                                phone: conv.phone,
                                conversationId: conv.conversationId,
                                replyStatus: 'ATENDIDO',
                                updatedAt: new Date()
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });
                        } catch (syncErr: any) {}
                        continue;
                    }

                    console.log(`[WSP BOT Recovery] Marcando conversación de ${conv.phone || conv.jid} como ATENDIDO en DB para prevenir reintentos duplicados.`);
                    try {
                        await axios.post(`${backendUrl}/api/v1/crm/chat/sync`, {
                            jid: conv.jid,
                            phone: conv.phone,
                            conversationId: conv.conversationId,
                            replyStatus: 'ATENDIDO',
                            updatedAt: new Date()
                        }, {
                            headers: { 'x-api-key': apiKey },
                            timeout: 15000
                        });
                    } catch (syncErr: any) {
                        console.error(`[WSP BOT Recovery Sync Error]: ${syncErr.message}`);
                    }
                }
            } else {
                console.log(`[WSP BOT Recovery] No hay conversaciones pendientes de respuesta.`);
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
