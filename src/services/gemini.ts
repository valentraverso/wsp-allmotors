import { GoogleGenAI, Tool, Type } from "@google/genai";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

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

2. **LOCALIDADES DE COBERTURA**:
   - Identifica siempre la localidad/ciudad del cliente. Recuerda que las sucursales internamente siguen la regla <nombre de la ciudad>_<identificador> o sólo <nombre de la ciudad>.

3. **FINANCIACIÓN Y CRÉDITO** 💸:
   - Pedí DNI y Género (M/F) de forma sutil y amigable para usar 'checkFinancing'. Si no quiere dar su DNI, aclarale en una sola oración que es necesario para consultar la calificación en las financieras.

4. **PROHIBICIÓN DE DAR PRECIOS DE VEHÍCULOS**:
   - Para venta de vehículos (0km/usados), no des precios o listas en el chat. Explicá brevemente que un asesor comercial se los pasará de forma personalizada.

5. **MOTOS USADAS**:
   - Indicá en una sola oración que vendemos usadas y tomamos usadas como parte de pago.

6. **TURNOS DE SERVICE (TALLER)** 🛠️:
   - Registrá el turno usando 'requestServiceAppointment' solicitando Nombre, Teléfono, Moto, Service, Sucursal y Fecha.

7. **LEADS DE VENTAS** 📝:
   - Si hay interés real de compra de motos, registralo con 'createLead'.

Sé directo, buena onda, ultra conciso y 100% enfocado en resolver rápido. 🇦🇷
`;

const tools: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "createLead",
                description: "Registra un nuevo lead (interesado) en el CRM de All Motors.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING, description: "Nombre completo del cliente" },
                        phone: { type: Type.STRING, description: "Número de teléfono/whatsapp" },
                        branch: { type: Type.STRING, description: "Sucursal de interés (Santa Fe, La Paz, etc.)" },
                        interest: { type: Type.STRING, description: "Moto o servicio en el que está interesado" }
                    },
                    required: ["name", "phone", "interest"]
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
                description: "Registra una solicitud de turno para el taller o service oficial.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING, description: "Nombre completo del cliente" },
                        phone: { type: Type.STRING, description: "Número de teléfono o WhatsApp" },
                        motoModel: { type: Type.STRING, description: "Marca y modelo de la moto" },
                        serviceType: { type: Type.STRING, description: "Tipo de service o reparación requerida (ej. service de 1000km, ruido en motor)" },
                        branch: { type: Type.STRING, description: "Sucursal elegida (Santa Fe, La Paz, Concordia, Santa Elena)" },
                        preferredDate: { type: Type.STRING, description: "Fecha y hora preferida por el cliente" }
                    },
                    required: ["name", "phone", "motoModel", "branch", "preferredDate"]
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
            }
        ]
    }
];

export class GeminiService {
    async chat(message: string, history: any[] = []) {
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
                        functionResult = { status: "success", message: "Lead registrado internamente en el buffer del CRM (Mock)" };
                    } else if (name === "requestServiceAppointment") {
                        console.log("[Gemini] Service appointment request:", args);
                        functionResult = { status: "success", message: "Turno de taller registrado internamente de manera exitosa (Mock)" };
                    } else if (name === "checkRepuestoStock") {
                        console.log("[Gemini] Checking repuesto stock:", args);
                        try {
                            const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
                            const apiKey = process.env.BACKEND_API_KEY || process.env.WSP_AUTH_CODE || "allmotors_secret_code_2026";
                            
                            const res = await axios.get(`${backendUrl}/api/v1/repuestos/stock/search`, {
                                params: { 
                                    query: args.repuestoName || "", 
                                    code: args.code || "", 
                                    locality: args.locality 
                                },
                                headers: { 
                                    'x-api-key': apiKey,
                                    'x-wsp-auth-code': apiKey 
                                }
                            });
                            functionResult = res.data;
                        } catch (error: any) {
                            console.log("[Gemini] Repuesto stock endpoint fallback for:", args);
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
                        try {
                            const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
                            const apiKey = process.env.BACKEND_API_KEY || process.env.WSP_AUTH_CODE || "allmotors_secret_code_2026";
                            
                            const dniClean = (args.dni || "").toString().replace(/\D/g, "");
                            const rawGender = (args.gender || "M").toString().toUpperCase();
                            const genderClean = rawGender.includes("F") || rawGender.includes("MUJER") || rawGender.includes("FEM") ? "F" : "M";

                            console.log(`[Gemini] Consultando preaprobación financiera para DNI: ${dniClean}, Género: ${genderClean}`);

                            const res = await axios.post(`${backendUrl}/api/v1/finance/preapproval-financials`, {
                                dni: dniClean,
                                gender: genderClean,
                                cellphone: ""
                            }, {
                                headers: { 
                                    'x-api-key': apiKey,
                                    'x-wsp-auth-code': apiKey 
                                },
                                timeout: 25000
                            });

                            functionResult = res.data;
                        } catch (error: any) {
                            console.error("[Gemini] Error al consultar backend de financieras:", error.message);
                            functionResult = { error: "No se pudo consultar la preaprobación crediticia en este momento." };
                        }
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