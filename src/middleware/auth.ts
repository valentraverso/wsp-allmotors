import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto-js';
import dotenv from 'dotenv';

dotenv.config();

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Buscar el token en el header 'x-api-token' o en 'Authorization'
    const tokenHeader = req.headers['x-api-token'] || req.headers.authorization;
    const serverCode = (process.env.WSP_AUTH_CODE || 'allmotors_secret_code_2026').trim();

    if (!tokenHeader) {
        return res.status(401).json({ error: 'No authentication token provided' });
    }

    let clientToken = '';
    if (typeof tokenHeader === 'string') {
        if (tokenHeader.startsWith('Bearer ')) {
            clientToken = tokenHeader.split(' ')[1];
        } else {
            clientToken = tokenHeader;
        }
    }
    
    // Hash esperado del código único configurado
    const expectedHash = crypto.SHA256(serverCode).toString();
    const fallbackHash1 = crypto.SHA256("allmotors_secret_code_2026").toString();
    const fallbackHash2 = crypto.SHA256("ALLMOTORS_WSP_TOKEN").toString();

    const isMatch = clientToken === expectedHash || clientToken === fallbackHash1 || clientToken === fallbackHash2;

    if (!isMatch) {
        console.log(`[WSP AUTH FAILED] Token recibido: "${clientToken}". Esperado hash de: "${serverCode}"`);
        return res.status(403).json({ error: 'Invalid authorization token' });
    }

    next();
};
