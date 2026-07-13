import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import whatsappService from './whatsapp';
import { authMiddleware } from './middleware/auth';
import QRCode from 'qrcode';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4001;

// Endpoint para enviar mensajes (Protegido con el código hasheado)
app.post('/send-message', authMiddleware, async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ error: 'Number and message are required' });
    }

    try {
        await whatsappService.sendMessage(number, message);
        res.status(200).json({ status: 'success', message: 'Message sent' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para obtener los grupos participando
app.get('/groups', authMiddleware, async (req, res) => {
    try {
        if (!whatsappService.sock) {
            return res.status(400).json({ error: 'WhatsApp socket not initialized' });
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
    res.json({ status: whatsappService.sock?.user ? 'connected' : 'disconnected' });
});

app.listen(PORT, () => {
    console.log(`WSP Microservice running on port ${PORT}`);
    whatsappService.init();
});
