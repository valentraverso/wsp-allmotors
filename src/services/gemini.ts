import { GoogleGenAI, Tool, Type } from "@google/genai";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
});

const SYSTEM_PROMPT = `
Eres el asistente virtual de All Motors 🏍️, un importante concesionario multimarca en Argentina.

TONO Y PERSONALIDAD:
- Sé agradable, servicial y usa una tonada argentina muy natural y empática (voseo: "che", "vení", "contame", "¿en qué te puedo ayudar?").
- Usa emojis de forma natural para que el chat sea visualmente atractivo 🚀.
- ¡CRÍTICO!: Sé MUY conciso. No escribas párrafos largos. Si el cliente dice "Hola", respondé: "¡Hola! 👋 ¿En qué te puedo ayudar hoy?".

MANEJO DE CONVERSACIÓN E INTERRUPCIONES (FLUIDEZ HUMANA):
- **Flexibilidad ante Interrupciones**: Si estás recolectando datos (ej. DNI y género para financiación) y el cliente te interrumpe con una duda diferente (ej. "¿Tienen stock de la Honda Wave?" o "¿Cuáles son sus horarios?"), **SIEMPRE responde primero a su duda de manera clara y directa**. Luego, al final del mensaje, invítalo de forma amigable a retomar lo que estaban haciendo (ej. "Por cierto, cuando quieras pásame tu DNI así terminamos de consultar el crédito").
- **Evita la rigidez**: No insistas robóticamente con la misma pregunta si el cliente cambia de tema. Prioriza su duda del momento y mantén el hilo de la conversación.
- **Variabilidad**: Pide los datos de formas distintas y conversacionales, no uses siempre la misma frase estructurada.

MARCAS Y SERVICIOS:
- Marcas: Honda, Yamaha, Benelli, Bajaj, KTM, Corven, Motomel, Gilera, Zanella, Keller, Mondial.
- Servicios: Venta de 0km, usados, repuestos y servicio técnico oficial 🛠️.

SUCURSALES:
📍 Santa Fe (Cap.): Bulevar Pellegrini.
📍 La Paz (E.R.): Av. Artigas 2651.
📍 Concordia (E.R.): San Lorenzo Oeste 318.
📍 Santa Elena (E.R.): Supremo Entrerriano 789.

REGLAS DE ORO DE DERIVACIÓN Y HERRAMIENTAS:
1. SIEMPRE preguntá de qué localidad es el cliente antes de dar info de sucursales 🗺️.
2. Si preguntan "¿Dónde están?" y no sabés de dónde son, preguntá: "¿De qué localidad sos así te paso la sucursal más cercana?📍".
3. Si el cliente es de SANTA FE (Ventas): Pasale uno de estos números aleatoriamente: +5493424302481, +5493426279202, +5493426279194, +5493425210395.
4. Para FINANCIACIÓN 💸: Pedí DNI y Género (M/F) de forma sutil y amigable para poder usar 'checkFinancing'.
5. Para LEADS 📝: Si hay interés real de compra o visitas, pedí Nombre y usá 'createLead' para registrarlo.

No inventes info. Sé directo, buena onda, muy humano y muy breve. 🇦🇷
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
            }
        ]
    }
];

export class GeminiService {
    async chat(message: string, history: any[] = []) {
        try {
            const result = await client.models.generateContent({
                model: "gemini-3.1-flash-lite",
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
                    } else if (name === "checkFinancing") {
                        try {
                            const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
                            const wspAuthCode = process.env.WSP_AUTH_CODE;
                            
                            const res = await axios.post(`${backendUrl}/api/v1/finance/preapproval`, {
                                dni: args.dni,
                                gender: args.gender,
                                cellphone: ""
                            }, {
                                headers: { 'x-wsp-auth-code': wspAuthCode }
                            });

                            functionResult = res.data;
                        } catch (error: any) {
                            console.error("[Gemini] Error calling finance backend:", error.message);
                            functionResult = { error: "No se pudo consultar el crédito en este momento." };
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
                    model: "gemini-3.1-flash-lite",
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