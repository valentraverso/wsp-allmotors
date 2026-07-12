# All Motors - Microservicio de WhatsApp (WSP)

`rsync -avz --exclude '.cache' --exclude 'node_modules' --exclude '.git' --exclude '.env' --exclude 'logs' --exclude 'auth_info_baileys' '/mnt/c/Users/vt200/Documents/All Motors/INTRANET/wsp/' root@147.93.33.22:/var/www/wsp`

Este microservicio se encarga de la integración con WhatsApp utilizando la librería `@whiskeysockets/baileys`. Permite enviar mensajes de texto y gestionar flujos automatizados (Chatbot) para la carga de documentos en la Intranet de All Motors.

## 🚀 Características

-   **Autenticación por QR**: Generación de código QR para vincular la cuenta.
-   **Chatbot de Documentos**: Flujo automático para que usuarios permitidos suban archivos directamente a la gestión documental.
-   **Seguridad**: Protección de endpoints mediante hash SHA256 de un código secreto.
-   **Persistencia**: Almacenamiento local de la sesión en `auth_info_baileys`.

## 🛠 Requisitos

-   **Node.js**: v18 o superior.

## 📦 Instalación

1.  Navega al directorio del servicio:
    ```bash
    cd wsp
    ```

2.  Instala las dependencias:
    ```bash
    npm install
    ```

3.  Configura las variables de entorno:
    Crea un archivo `.env` basado en el siguiente ejemplo:
    ```env
    PORT=4001
    WSP_AUTH_CODE=tu_codigo_secreto_aqui
    BACKEND_URL=http://localhost:4000
    ```

## 🚦 Inicio del Servicio

### Modo Desarrollo (con recarga automática)
```bash
npm run dev
```

### Modo Producción
```bash
npm run build
npm start
```

## 🔌 API Endpoints

### 1. Vincular Cuenta (Obtener QR)
**GET** `/qr`
-   Devuelve una imagen en formato DataURL con el código QR para escanear desde WhatsApp.
-   *Nota: Si ya está conectado, devolverá un error 404.*

### 2. Estado de la Conexión
**GET** `/status`
-   Responde `{ "status": "connected" }` o `{ "status": "disconnected" }`.

### 3. Enviar Mensaje
**POST** `/send-message`
-   **Headers**: `Authorization: Bearer <SHA256(WSP_AUTH_CODE)>`
-   **Body**:
    ```json
    {
      "number": "54911...",
      "message": "Hola desde la Intranet!"
    }
    ```

## 🤖 Lógica del Chatbot

El servicio incluye un listener que reacciona a mensajes entrantes:
1.  **Whitelist**: Solo responde a números configurados en el Backend (`BACKEND_URL/api/v1/config/whatsapp`).
2.  **Carga de Archivos**: Si un usuario permitido envía una imagen o documento, el bot preguntará si desea guardarlo.
3.  **Confirmación**: Al responder con "1", el archivo se procesa y se envía al endpoint `/api/v1/documents/bot-upload` del backend principal.

## 📁 Estructura del Proyecto

-   `src/index.ts`: Punto de entrada y servidor Express.
-   `src/whatsapp.ts`: Servicio principal que maneja la conexión con Baileys.
-   `src/middleware/auth.ts`: Validación de seguridad para los endpoints.
-   `auth_info_baileys/`: Carpeta (generada automáticamente) que contiene las credenciales de la sesión.

---
*Desarrollado para All Motors Group S.A.*
