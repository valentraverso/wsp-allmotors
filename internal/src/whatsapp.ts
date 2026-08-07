import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    ConnectionState,
    WASocket,
    WAMessageContent,
    WAMessageKey
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import qrcodeTerminal from 'qrcode-terminal';

dotenv.config({ path: path.join(__dirname, '../.env') });

const groupCache = new Map<string, any>();

class InternalWhatsappService {
    public sock: WASocket | null = null;
    private qr: string | null = null;
    private isInitializing = false;

    async init() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            console.log('[WSP INTERNAL] Initializing WhatsApp Notification Service...');
            
            if (this.sock) {
                try {
                    this.sock.ev.removeAllListeners('connection.update');
                    this.sock.ev.removeAllListeners('creds.update');
                    this.sock.ev.removeAllListeners('messages.upsert');
                    this.sock.end(undefined); 
                } catch (e) {
                    console.log('[WSP INTERNAL] Prev connection already closed');
                }
                this.sock = null;
            }

            const authFolder = process.env.AUTH_DIR || 'auth_info_baileys_internal';
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

            this.sock.ev.on('groups.update', async ([event]) => {
                try {
                    if (this.sock && event.id) {
                        const metadata = await this.sock.groupMetadata(event.id);
                        groupCache.set(event.id, metadata);
                    }
                } catch (e) {
                    console.error('[WSP INTERNAL] Error updating group metadata:', e);
                }
            });

            this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    this.qr = qr;
                    console.log(`[WSP INTERNAL] New QR Code generated. Scan with your Internal Notification WhatsApp:`);
                    qrcodeTerminal.generate(qr, { small: true });
                }
                
                if (connection === 'close') {
                    const error = lastDisconnect?.error as Boom;
                    const statusCode = error?.output?.statusCode;
                    const errorMessage = error?.message || '';
                    
                    console.log(`[WSP INTERNAL] Connection closed. Status code: ${statusCode}. Error: ${errorMessage}`);
                    this.isInitializing = false;
                    
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log(`[WSP INTERNAL] Session logged out. Clearing credentials folder (${authPath})...`);
                        try {
                            if (fs.existsSync(authPath)) {
                                fs.rmSync(authPath, { recursive: true, force: true });
                            }
                        } catch (err) {
                            console.error('[WSP INTERNAL] Error clearing credentials folder:', err);
                        }
                        setTimeout(() => this.init(), 2000);
                    } else {
                        console.log('[WSP INTERNAL] Reconnecting in 5 seconds...');
                        setTimeout(() => this.init(), 5000);
                    }
                } else if (connection === 'open') {
                    this.qr = null;
                    this.isInitializing = false;
                    console.log(`✓ [WSP INTERNAL] WhatsApp Internal Notification Service connected!`);
                }
            });

            // EL SERVICIO INTERNO IGNORA TODOS LOS MENSAJES ENTRANTES (NO ATIENDE CONVERSACIONES)
            this.sock.ev.on('messages.upsert', () => {
                return;
            });
        } catch (error) {
            console.error('[WSP INTERNAL] Error during WhatsApp init:', error);
            this.isInitializing = false;
            setTimeout(() => this.init(), 10000);
        }
    }

    async sendMessage(target: string, message: string, retryCount = 0): Promise<void> {
        if (!this.sock) {
            console.error('[WSP INTERNAL] Socket not initialized. Cannot send notification.');
            throw new Error('WhatsApp socket not initialized');
        }
        
        let jid = target.trim();

        // 1. Manejo de Grupos de WhatsApp (@g.us)
        if (jid.includes('@g.us') || (jid.length > 15 && !jid.includes('@') && jid.startsWith('120'))) {
            if (!jid.endsWith('@g.us')) {
                jid = jid + '@g.us';
            }
        } 
        // 2. Manejo de Números Individuales
        else if (!jid.includes('@')) {
            let cleanNumber = jid.replace(/\D/g, '');
            
            if (cleanNumber.length === 10) {
                cleanNumber = '549' + cleanNumber;
            } else if (cleanNumber.startsWith('54') && !cleanNumber.startsWith('549') && cleanNumber.length === 12) {
                cleanNumber = '549' + cleanNumber.substring(2);
            } else if (cleanNumber.startsWith('0') && cleanNumber.length === 11) {
                cleanNumber = '549' + cleanNumber.substring(1);
            }

            try {
                const results = await this.sock.onWhatsApp(cleanNumber);
                if (results && results.length > 0 && results[0]?.exists && results[0]?.jid) {
                    jid = results[0].jid;
                } else {
                    const altNumber = cleanNumber.startsWith('549') ? '54' + cleanNumber.substring(3) : cleanNumber;
                    const altResults = await this.sock.onWhatsApp(altNumber);
                    if (altResults && altResults.length > 0 && altResults[0]?.exists && altResults[0]?.jid) {
                        jid = altResults[0].jid;
                    } else {
                        jid = cleanNumber + '@s.whatsapp.net';
                    }
                }
            } catch (err: any) {
                jid = cleanNumber + '@s.whatsapp.net';
            }
        }

        try {
            console.log(`[WSP INTERNAL] Sending system notification to ${jid}...`);
            await this.sock.sendMessage(jid, { text: message });
            console.log(`[WSP INTERNAL] Notification successfully sent to ${jid}`);
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
        const authFolder = process.env.AUTH_DIR || 'auth_info_baileys_internal';
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

export default new InternalWhatsappService();
