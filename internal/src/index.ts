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

console.log = (...args: any[]) => originalLog(`[${getArgentinaTimestamp()}]`, ...args);
console.warn = (...args: any[]) => originalWarn(`[${getArgentinaTimestamp()}]`, ...args);
console.error = (...args: any[]) => originalError(`[${getArgentinaTimestamp()}]`, ...args);
console.info = (...args: any[]) => originalInfo(`[${getArgentinaTimestamp()}]`, ...args);

dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4001;

// Endpoint para enviar notificaciones del sistema
app.post('/send-message', authMiddleware, async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ error: 'Number and message are required' });
    }

    try {
        await whatsappService.sendMessage(number, message);
        res.status(200).json({ status: 'success', message: 'Internal system notification sent' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para obtener los grupos participando
app.get('/groups', authMiddleware, async (req, res) => {
    try {
        if (!whatsappService.sock) {
            return res.status(400).json({ error: 'WhatsApp internal socket not initialized' });
        }
        const groups = await whatsappService.sock.groupFetchAllParticipating();
        const list = Object.keys(groups).map(jid => ({
            id: jid,
            name: groups[jid].subject
        }));
        res.status(200).json({ status: 'success', groups: list });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

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
        service: 'wsp-internal',
        status: whatsappService.sock?.user ? 'connected' : 'disconnected' 
    });
});

// Endpoint para desvincular/logout de WhatsApp Internal
app.post('/logout', authMiddleware, async (req, res) => {
    try {
        await whatsappService.logout();
        res.status(200).json({ status: 'success', message: 'WhatsApp internal session logged out.' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`[WSP INTERNAL] Service running on port ${PORT}`);
    whatsappService.init();
});
