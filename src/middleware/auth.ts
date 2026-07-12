import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto-js';
import dotenv from 'dotenv';

dotenv.config();

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Buscar el token en el header 'x-api-token' o en 'Authorization'
    const tokenHeader = req.headers['x-api-token'] || req.headers.authorization;
    const serverCode = (process.env.WSP_AUTH_CODE || '').trim();

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
    
    // El cliente debe enviar el hash SHA256 del código único
    const expectedHash = crypto.SHA256(serverCode).toString();

    console.log(`[WSP AUTH] Received Token: "${clientToken}"`);
    console.log(`[WSP AUTH] Expected Token: "${expectedHash}" (from WSP_AUTH_CODE length: ${serverCode.length}, prefix: "${serverCode.substring(0, 4)}...")`);

    if (clientToken !== expectedHash) {
        return res.status(403).json({ error: 'Invalid authorization token' });
    }

    next();
};
