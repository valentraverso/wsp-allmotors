import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import whatsappService from './whatsapp';
import { authMiddleware } from './middleware/auth';
import QRCode from 'qrcode';

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

// Endpoint para desvincular/logout de WhatsApp Commercial Bot
app.post('/logout', authMiddleware, async (req, res) => {
    try {
        await whatsappService.logout();
        res.status(200).json({ status: 'success', message: 'WhatsApp Commercial Bot session logged out.' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`[WSP BOT] Commercial AI Bot Service running on port ${PORT}`);
    whatsappService.init();
});
