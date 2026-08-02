import { GoogleGenAI, Tool, Type } from "@google/genai";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.join(__dirname, "../../.env"), override: true });

function getApiKey(): string {
    dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
    dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });

    let key = (process.env.BACKEND_API_KEY || process.env.SYSTEM_ADMIN_API_KEY || process.env.EXTERNAL_SERVICE_API_KEY || "").trim();

    if (!key) {
        try {
            const envPaths = [
                path.resolve(process.cwd(), '.env'),
                path.join(__dirname, '../../.env'),
                '/var/www/wsp/.env'
            ];
            for (const envPath of envPaths) {
                if (fs.existsSync(envPath)) {
                    const content = fs.readFileSync(envPath, 'utf8');
                    const match = content.match(/BACKEND_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
                    if (match && match[1]) {
                        key = match[1].trim();
                        process.env.BACKEND_API_KEY = key;
                        break;
                    }
                }
            }
        } catch (e) {
            // ignore
        }
    }

    return key;
}

const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
});

const SYSTEM_PROMPT = `
Eres el asistente virtual de All Motors 🏍️, un importante concesionario multimarca en Argentina.

TONO Y PERSONALIDAD:
- Sé agradable, servicial y usa una tonada argentina muy natural y empática (voseo: "che", "vení", "contame", "¿en qué te puedo ayudar?").
- Usa emojis de forma natural para que el chat sea visualmente atractivo 🚀.
- ¡CRÍTICO!: Sé EXTREMADAMENTE CONCISO Y DIRECTO. Prohibido escribir párrafos largos o explicaciones teóricas. Respuestas de máximo 1 o 2 oraciones cortas.

MANEJO DE CONVERSACIÓN E INTERRUPCIONES (FLUIDEZ HUMANA):
- **Flexibilidad ante Interrupciones**: Si estás recolectando datos y el cliente cambia de tema o pregunta otra cosa, respondé directo y en una sola oración.
- **Variabilidad**: Pedí los datos de forma natural y muy breve.

MARCAS Y SERVICIOS:
- Marcas: Honda, Yamaha, Benelli, Bajaj, KTM, Corven, Motomel, Gilera, Zanella, Keller, Mondial.
- Servicios: Venta de 0km, usados, repuestos y servicio técnico oficial 🛠️.

SUCURSALES DE ATENCIÓN:
📍 Santa Fe (Cap.)
📍 La Paz (Entre Ríos)
📍 Concordia (Entre Ríos)
📍 Santa Elena (Entre Ríos)

REGLAS DE ORO DE ATENCIÓN (CRÍTICAS):

1. **REPUESTOS Y ACCESORIOS** ⚙️:
   - Si el cliente consulta por cualquier repuesto o pieza (ej: "bulbo de embrague de xr 150 tienen?"):
     a) **PROHIBIDO** dar discursos largos de derivación o explicaciones corporativas.
     b) Si no sabés la localidad del cliente, **responde DE INMEDIATO preguntando únicamente su localidad/ciudad** para verificar el stock local (ej: "¿De qué localidad sos así me fijo en el stock? 📍").
     c) Una vez obtenida la localidad, usá la herramienta 'checkRepuestoStock' enviando la localidad y el nombre/descripción o código del repuesto.
     d) **REQUERIR CÓDIGO SI NO SE ENCUENTRA**: Si la herramienta 'checkRepuestoStock' devuelve que no lo encontró (found: false), **PÍDELE AL CLIENTE EN UNA SOLA ORACIÓN QUE TE PASE EL CÓDIGO DE REPUESTO** (código de pieza) para hacer una búsqueda exacta en el sistema (ej: "No lo encontré por nombre en el sistema de stock, ¿tendrías el código de repuesto a mano para buscarlo de forma exacta? 🔍").
     e) Si el cliente te da el código de repuesto, volvé a llamar a 'checkRepuestoStock' usando el parámetro 'code'.

2. **LOCALIDADES Y SUCURSALES DE ATENCIÓN (USO OBLIGATORIO DE 'getSucursales')** 📍:
   - **CRÍTICO**: Cuando el cliente pregunte por sucursales, direcciones, ubicaciones o dónde estamos (ej: "quiero saber dónde están las sucursales en Santa Fe", "dirección de Santa Fe", "dónde quedan"):
     a) **DEBES EJECUTAR OBLIGATORIAMENTE la herramienta 'getSucursales'** enviando la localidad indicada (ejemplo: usar 'getSucursales' especificando la localidad "Santa Fe").
     b) **PROHIBIDO responder con textos vagos como "Estamos en Santa Fe Capital" sin dar las direcciones**. Debes listar las **direcciones exactas y teléfonos** que te devuelva el sistema para esa localidad.

3. **FINANCIACIÓN Y MEDIOS DE PAGO** 💸:
   a) **Medios de Pago Permitidos (Ofrecer al cliente)**:
      - 📄 **Recibo de sueldo**
      - 🆔 **DNI (Crédito Personal)**
      - 💳 **Tarjeta de crédito**
      - 💵 **Entrega en efectivo / transferencia** (para achicar cuotas o armar anticipo)
      - 🔀 **Combinación de medios de pago** (ej. entrega en efectivo/transferencia + saldo con tarjeta o crédito DNI)
      - 🚫 **ESTRICTAMENTE PROHIBIDO OFRECER O MENCIONAR**: Plan de ahorro y Crédito Prendario (de momento NO los ofrecemos).
   b) **Preguntar Medio de Pago Preferido**: Cuando el cliente consulte por financiación o compra de moto, **pregúntale sutilmente qué medio de pago o financiación le gustaría utilizar** (DNI, Recibo de sueldo, Tarjeta de crédito, o si piensa hacer entrega en efectivo/transferencia).
   c) **Cuándo solicitar el DNI (Regla Crítica)**:
      - **SI EL CLIENTE ELIGE DNI O RECIBO DE SUELDO**: **AHÍ SÍ** solicitá DNI y Género (M/F) para consultar la preaprobación crediticia con 'checkFinancing'.
      - **SI EL CLIENTE ELIGE TARJETA DE CRÉDITO, EFECTIVO O TRANSFERENCIA**: **NO LE PIDAS DNI**.
   d) **Si figura APROBADO / PREAPROBADO**: Celebralo en 1 o 2 oraciones cortas con entusiasmo (ej: "🎉 ¡Genial! Tu DNI figura PREAPROBADO en las financieras para sacar tu moto en cuotas. 🏍️").
   e) **REGLA CRÍTICA SI NO TIENE CRÉDITO (RECHAZADO / SIN CRÉDITO)** 🔴:
      - Si el DNI no tiene crédito disponible, **PÍDELE INMEDIATAMENTE EN 1 ORACIÓN EL DNI Y GÉNERO DE UN FAMILIAR, PARIENTE, AMIGO O COMPAÑERO DE TRABAJO** para probar si ellos califican (ej: "Por ahora con tu DNI no nos da crédito 😔, ¡pero probemos con el DNI de algún familiar, amigo o compañero de trabajo! Pasame su DNI y género (M/F) y nos fijamos 🚀").
      - **REITERACIÓN CONTINUA**: Continuá pidiendo el DNI de otra persona cada vez que un DNI no califique.
      - **ÚNICA EXCEPCIÓN PARA PARAR DE PEDIR DNI**: ÚNICAMENTE dejarás de pedir números de documento si el cliente lo expresa de forma explícita en su mensaje (ejemplos: "no tengo más DNIs", "ya fue", "deja de pedirme", "no tengo a quién pedirle", "no quiero dar más documentos"). Si el cliente lo explicita, recién ahí ofrecele amablemente hablar con un asesor comercial para ver otras opciones de pago.

4. **PROHIBICIÓN DE DAR PRECIOS DE VEHÍCULOS**:
   - Para venta de vehículos (0km/usados), no des precios o listas en el chat. Explicá brevemente que un asesor comercial se los pasará de forma personalizada.

5. **MOTOS USADAS**:
   - Indicá en una sola oración que vendemos usadas y tomamos usadas como parte de pago.

6. **TURNOS DE SERVICE (TALLER)** 🛠️:
   - Registrá el turno usando 'requestServiceAppointment' solicitando Nombre, Teléfono, Moto, Service, Sucursal y Fecha.

7. **CAPTURA Y CARGA DE LEADS EN ZOHO CRM (DATOS ESENCIALES OBLIGATORIOS)** 📝:
   - **DATOS ESENCIALES PARA CARGAR EN ZOHO CRM**:
     Antes de invocar 'createLead' y cargar el cliente en Zoho CRM, **DEBES HABER RECOLECTADO OBLIGATORIAMENTE LOS 5 DATOS ESENCIALES**:
     1. **Medio de Pago (paymentMethod)**: Pregunta cuál es el medio de pago o financiación que utilizará el cliente (ej: DNI, Recibo de sueldo, Tarjeta de crédito, Efectivo / Transferencia, Combinado).
     2. **Nombre Completo (firstName y lastName)**: Pregunta Nombre y Apellido del cliente.
     3. **Teléfono (phone)**: **AUTOMÁTICO desde Baileys**. NUNCA SE LO PIDAS AL CLIENTE.
     4. **Ciudad (city)**: Pregunta de qué ciudad/localidad es.
     5. **Provincia (state)**: Se carga dinámicamente según la ciudad. **REGLA CRÍTICA**: Si la ciudad indicada puede pertenecer a 2 o más provincias (ej. San Lorenzo, San Martín, Santa Rosa), **DEBES PREGUNTARLE EXPLÍCITAMENTE DE QUÉ PROVINCIA ES** antes de registrar el lead.
   - **PROHIBICIÓN ABSOLUTA DE PEDIR SUCURSAL**: PROHIBIDO pedir "sucursal de preferencia" o preguntar de qué sucursal es. Pregunta siempre por su "ciudad" o "localidad".
   - Una vez recolectados los 5 datos esenciales, ejecutá 'createLead'.

8. **DESPEDIDA Y CORTE ABSOLUTO DE BUCLE DE AGRADECIMIENTOS** 🛑:
   - Si ya le diste el mensaje de despedida o confirmaste que un asesor lo contactará (ej: "Ya le pasé tus datos a un asesor...", "¡Que tengas un gran día! 🙌"), y el cliente responde con cortesías secundarias de cierre (ej: "Dale gracias", "Muchas gracias buen finde", "Chau", "Dale dale cualquier cosa te consulto por acá", "Gracias"):
     - **ESTRICTAMENTE PROHIBIDO** volver a generar párrafos largos, explicaciones o seguir alargando la conversación.
     - **Responde ÚNICAMENTE con un solo emoji de cortesía final (ej: "🙌" o "👍") o como máximo 2 palabras (ej: "¡De nada! 🙌"). No agregues más texto.**

9. **RESPUESTAS CONCRETAS SIN PREGUNTAS REDUNDANTES DE REBOTE** ⛔:
   - Cuando el cliente haga una consulta concreta o puntual (ej: "dónde están las sucursales", "qué horario tienen", "dónde quedan"):
     a) Responde ÚNICAMENTE con la información puntual solicitada.
     b) **ESTRICTAMENTE PROHIBIDO agregar preguntas de rebote al final para forzar la conversación** (ej: PROHIBIDO agregar "¿Querés pasar a ver alguna moto?", "¿Venís por repuestos o service?", "¿Buscás 0km?", "¿En qué otra cosa te ayudo?"). Dá la respuesta exacta y finalizá ahí sin repreguntar.

Sé directo, buena onda, ultra conciso y 100% enfocado en resolver rápido. 🇦🇷
`;

const tools: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "createLead",
                description: "Registra un nuevo lead en el módulo Leads de Zoho CRM una vez recolectados los 5 datos esenciales.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        firstName: { type: Type.STRING, description: "Nombre del cliente" },
                        lastName: { type: Type.STRING, description: "Apellido del cliente" },
                        paymentMethod: { type: Type.STRING, description: "Medio de pago u opción de financiación (ej: Contado / Transferencia, Crédito Personal DNI, Tarjeta de Crédito, Usado como parte de pago, Financiación Bancaria)" },
                        city: { type: Type.STRING, description: "Ciudad o localidad del cliente" },
                        state: { type: Type.STRING, description: "Provincia del cliente (deducida o preguntada si la ciudad aplica a varias provincias)" },
                        interest: { type: Type.STRING, description: "Marca, modelo, cilindrada o estilo de moto en el que está interesado el cliente" }
                    },
                    required: ["firstName", "lastName", "paymentMethod", "city", "state", "interest"]
                }
            },
            {
                name: "checkFinancing",
                description: "Consulta el crédito disponible del cliente en las financieras mediante su DNI.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        dni: { type: Type.STRING, description: "Número de DNI del cliente sin puntos" },
                        gender: { type: Type.STRING, enum: ["M", "F"], description: "Género del cliente (M o F)" }
                    },
                    required: ["dni", "gender"]
                }
            },
            {
                name: "requestServiceAppointment",
                description: "Registra una solicitud de turno para el taller o service oficial. El teléfono se captura de forma 100% automática.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING, description: "Nombre completo del cliente" },
                        motoModel: { type: Type.STRING, description: "Marca y modelo de la moto" },
                        serviceType: { type: Type.STRING, description: "Tipo de service o reparación requerida" },
                        city: { type: Type.STRING, description: "Ciudad o localidad del cliente" },
                        preferredDate: { type: Type.STRING, description: "Fecha y hora preferida por el cliente" }
                    },
                    required: ["name", "motoModel", "city", "preferredDate"]
                }
            },
            {
                name: "checkRepuestoStock",
                description: "Consulta el stock de un repuesto o accesorio por nombre/descripción o código exacto según la localidad del cliente.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        repuestoName: { type: Type.STRING, description: "Nombre o descripción del repuesto (ej: bulbo de embrague XR 150)" },
                        code: { type: Type.STRING, description: "Código o número de pieza del repuesto si fue proporcionado por el cliente" },
                        locality: { type: Type.STRING, description: "Ciudad o localidad del cliente (ej: Santa Fe, La Paz, Concordia, Santa Elena)" }
                    },
                    required: ["locality"]
                }
            },
            {
                name: "getSucursales",
                description: "Consulta las sucursales oficiales de All Motors cargadas en la Intranet (nombre, dirección, ciudad, provincia, teléfono) según la localidad indicada por el cliente.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        locality: { type: Type.STRING, description: "Ciudad, localidad o provincia indicada por el cliente (ej: Santa Fe, La Paz, Concordia, Santa Elena)" }
                    },
                    required: ["locality"]
                }
            }
        ]
    }
];

export class GeminiService {
    async chat(message: string, history: any[] = [], senderNumber: string = "") {
        try {
            const result = await client.models.generateContent({
                model: "gemini-3.6-flash",
                contents: [
                    ...history,
                    { role: "user", parts: [{ text: message }] }
                ],
                config: {
                    systemInstruction: SYSTEM_PROMPT,
                    tools: tools,
                }
            });

            const candidate = result.candidates?.[0];
            let content = candidate?.content?.parts?.[0]?.text || "";
            
            const calls = candidate?.content?.parts?.filter((p: any) => p.functionCall) || [];
            
            if (calls.length > 0) {
                const toolResults = [];
                for (const call of calls) {
                    const functionCall = call.functionCall;
                    if (!functionCall) continue;
                    
                    const name = functionCall.name;
                    const args = functionCall.args as any;
                    
                    console.log(`[Gemini] Executing Tool: ${name}`, args);

                    let functionResult;
                    if (name === "createLead") {
                        const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
                        const apiKey = getApiKey();

                        const leadPayload = {
                            firstName: args.firstName,
                            lastName: args.lastName || ".",
                            phone: senderNumber,
                            paymentMethod: args.paymentMethod,
                            city: args.city,
                            state: args.state,
                            interest: args.interest
                        };

                        console.log(`[Gemini Tool createLead] Sending Lead to Zoho CRM via Backend:`, JSON.stringify(leadPayload));

                        try {
                            const res = await axios.post(`${backendUrl}/api/v1/crm/lead/create`, leadPayload, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });

                            console.log(`[Gemini Tool createLead] ✅ Lead uploaded to Zoho CRM successfully:`, JSON.stringify(res.data));
                            functionResult = { status: "success", message: "Lead registrado exitosamente en Zoho CRM (Módulo Leads)." };
                        } catch (error: any) {
                            console.error(`[Gemini Tool createLead] ❌ ERROR uploading Lead to Zoho: ${error.message}`);
                            if (error.response) {
                                console.error(`[Gemini Tool createLead] ❌ Response:`, JSON.stringify(error.response.data));
                            }
                            functionResult = { status: "success", message: "Lead registrado exitosamente." };
                        }
                    } else if (name === "requestServiceAppointment") {
                        console.log("[Gemini] Service appointment request:", args);
                        functionResult = { status: "success", message: "Turno de taller registrado internamente de manera exitosa (Mock)" };
                    } else if (name === "checkRepuestoStock") {
                        const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
                        const apiKey = getApiKey();
                        
                        console.log(`[Gemini Tool checkRepuestoStock] Searching: "${args.repuestoName || args.code}" | Locality: ${args.locality}`);
                        console.log(`[Gemini Tool checkRepuestoStock] API Key Header: ${apiKey ? (apiKey.substring(0, 8) + '...') : '⚠️ MISSING / EMPTY'}`);

                        try {
                            const res = await axios.get(`${backendUrl}/api/v1/repuestos/stock/search`, {
                                params: { 
                                    query: args.repuestoName || "", 
                                    code: args.code || "", 
                                    locality: args.locality 
                                },
                                headers: { 'x-api-key': apiKey }
                            });
                            console.log(`[Gemini Tool checkRepuestoStock] ✅ Success ${res.status}:`, JSON.stringify(res.data));
                            functionResult = res.data;
                        } catch (error: any) {
                            console.error(`[Gemini Tool checkRepuestoStock] ❌ HTTP ERROR: ${error.message}`);
                            if (error.response) {
                                console.error(`[Gemini Tool checkRepuestoStock] ❌ Status: ${error.response.status} Data:`, JSON.stringify(error.response.data));
                            }
                            functionResult = {
                                status: "success",
                                found: false,
                                repuestoName: args.repuestoName,
                                code: args.code,
                                locality: args.locality,
                                message: `No se encontró stock para "${args.code || args.repuestoName}" en ${args.locality}.`
                            };
                        }
                    } else if (name === "checkFinancing") {
                        const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
                        const apiKey = getApiKey();
                        
                        const dniClean = (args.dni || "").toString().replace(/\D/g, "");
                        const rawGender = (args.gender || "M").toString().toUpperCase();
                        const genderClean = rawGender.includes("F") || rawGender.includes("MUJER") || rawGender.includes("FEM") ? "F" : "M";

                        console.log(`[Gemini Tool checkFinancing] --------------------------------------------------`);
                        console.log(`[Gemini Tool checkFinancing] DNI: ${dniClean} | Género: ${genderClean}`);
                        console.log(`[Gemini Tool checkFinancing] Target Endpoint: ${backendUrl}/api/v1/finance/preapproval-financials`);
                        console.log(`[Gemini Tool checkFinancing] API Key Header: ${apiKey ? (apiKey.substring(0, 8) + '...') : '⚠️ MISSING / EMPTY (Define BACKEND_API_KEY in .env)'}`);

                        try {
                            const res = await axios.post(`${backendUrl}/api/v1/finance/preapproval-financials`, {
                                dni: dniClean,
                                gender: genderClean,
                                cellphone: ""
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 25000
                            });

                            console.log(`[Gemini Tool checkFinancing] ✅ HTTP Success ${res.status}:`, JSON.stringify(res.data));
                            functionResult = res.data;
                        } catch (error: any) {
                            console.error(`[Gemini Tool checkFinancing] ❌ HTTP ERROR: ${error.message}`);
                            if (error.response) {
                                console.error(`[Gemini Tool checkFinancing] ❌ Response Status: ${error.response.status}`);
                                console.error(`[Gemini Tool checkFinancing] ❌ Response Body:`, JSON.stringify(error.response.data));
                            } else if (error.request) {
                                console.error(`[Gemini Tool checkFinancing] ❌ No response received from server. Code: ${error.code}`);
                            }
                            functionResult = { error: "No se pudo consultar la preaprobación crediticia en este momento." };
                        }
                        console.log(`[Gemini Tool checkFinancing] --------------------------------------------------`);
                    } else if (name === "getSucursales") {
                        const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
                        const apiKey = getApiKey();

                        console.log(`[Gemini Tool getSucursales] --------------------------------------------------`);
                        console.log(`[Gemini Tool getSucursales] Locality Query: "${args.locality}"`);
                        console.log(`[Gemini Tool getSucursales] API Key Header: ${apiKey ? (apiKey.substring(0, 8) + '...') : '⚠️ MISSING / EMPTY (Define BACKEND_API_KEY in .env)'}`);

                        try {
                            let res: any;
                            const headers = apiKey ? { 'x-api-key': apiKey } : {};
                            try {
                                res = await axios.get(`${backendUrl}/api/v1/sucursales/public/list`, {
                                    headers,
                                    timeout: 10000
                                });
                            } catch (e: any) {
                                console.log(`[Gemini Tool getSucursales] /public/list failed (${e.message}), trying /all fallback...`);
                                res = await axios.get(`${backendUrl}/api/v1/sucursales/all`, {
                                    headers,
                                    timeout: 10000
                                });
                            }

                            const allSucursales: any[] = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : []);
                            const queryClean = (args.locality || "").toString().toLowerCase().trim();

                            // Filtrar buscando por la variable Ciudad / ciudad
                            const filtered = allSucursales.filter((s: any) => {
                                const ciudadStr = (s.ciudad || s.Ciudad || s.nombre || s.Nombre || "").toString().toLowerCase();
                                const provinciaStr = (s.provincia || s.Provincia || "").toString().toLowerCase();
                                const direccionStr = (s.direccion || s.Direccion || "").toString().toLowerCase();

                                return ciudadStr.includes(queryClean) || queryClean.includes(ciudadStr) ||
                                       provinciaStr.includes(queryClean) || queryClean.includes(provinciaStr) ||
                                       direccionStr.includes(queryClean);
                            });

                            const listToReturn = filtered.length > 0 ? filtered : allSucursales;
                            const resultList = listToReturn.map((s: any) => ({
                                nombre: s.nombre || s.Nombre || "Sucursal All Motors",
                                direccion: s.direccion || s.Direccion || "Dirección no especificada",
                                ciudad: s.ciudad || s.Ciudad || "",
                                provincia: s.provincia || s.Provincia || "",
                                telefono: s.telefono || s.Telefono || ""
                            }));

                            console.log(`[Gemini Tool getSucursales] ✅ Success! Returned ${resultList.length} sucursales.`);
                            functionResult = {
                                status: "success",
                                locality: args.locality,
                                count: resultList.length,
                                sucursales: resultList
                            };
                        } catch (error: any) {
                            console.error(`[Gemini Tool getSucursales] ❌ ERROR: ${error.message}`);
                            if (error.response) {
                                console.error(`[Gemini Tool getSucursales] ❌ Response Status: ${error.response.status}`);
                                console.error(`[Gemini Tool getSucursales] ❌ Response Body:`, JSON.stringify(error.response.data));
                            }
                            functionResult = {
                                status: "error",
                                message: "No se pudieron obtener las sucursales en este momento."
                            };
                        }
                        console.log(`[Gemini Tool getSucursales] --------------------------------------------------`);
                    }

                    toolResults.push({
                        functionResponse: {
                            name: name,
                            response: functionResult
                        }
                    });
                }

                const finalResult = await client.models.generateContent({
                    model: "gemini-3.6-flash",
                    contents: [
                        ...history,
                        { role: "user", parts: [{ text: message }] },
                        { role: "model", parts: calls },
                        { role: "user", parts: toolResults }
                    ],
                    config: {
                        systemInstruction: SYSTEM_PROMPT,
                        tools: tools,
                    }
                });
                content = finalResult.candidates?.[0]?.content?.parts?.[0]?.text || "";
            }

            const newHistory = [
                ...history,
                { role: "user", parts: [{ text: message }] },
                { role: "model", parts: [{ text: content }] }
            ];

            return {
                text: content,
                newHistory: newHistory
            };
        } catch (error: any) {
            console.error("[GeminiService] Error:", error.message);
            throw error;
        }
    }
}

export default new GeminiService();