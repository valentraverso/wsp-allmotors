import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { getGeminiApiKey } from "./config/env";
import { hydrateCoreMemory, persistCoreMemoryAsync } from "./memory/coreMemory";
import { buildModularSystemPrompt } from "./prompts/promptBuilder";
import { buildBotStructuredTools } from "./tools/botTools";
import { createLangfuseCallbacks } from "./observability/langfuse";

export function getSlidingWindowMessages(messages: any[], max = 8) {
  const window = (Array.isArray(messages) ? [...messages] : []).slice(-max);
  while (window.length > 0 && window[0].role === "model") {
    window.shift();
  }
  return window.map((msg) => {
    const textVal = (typeof msg.text === "string" ? msg.text : (typeof msg.content === "string" ? msg.content : msg.parts?.[0]?.text)) || "";
    return {
      role: msg.role === "model" ? "model" : "user",
      text: textVal,
      parts: [{ text: textVal }]
    };
  });
}

function extractTextFromAIMessage(aiMsg: AIMessage): string {
  if (typeof aiMsg.content === "string") {
    return aiMsg.content.trim();
  }
  if (Array.isArray(aiMsg.content)) {
    return aiMsg.content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter((t: string) => t.trim().length > 0)
      .join("\n")
      .trim();
  }
  return "";
}

export async function runManuelBotardoAgent(params: {
  message: string;
  history: any[];
  senderNumber: string;
  senderJid: string;
  clientContext?: any;
  conversationId?: string;
  leadContextText?: string;
  onDeferredCreditCheck?: (data: {
    jid: string;
    senderNumber: string;
    dni: string;
    gender: string;
    conversationId?: string;
    isGuarantor?: boolean;
    guarantorName?: string;
    relationship?: string;
  }) => void;
  mediaData?: { data: string; mimeType: string };
}): Promise<{ text: string; newHistory: any[] }> {
  const {
    message,
    history = [],
    senderNumber = "",
    senderJid = "",
    clientContext,
    conversationId,
    onDeferredCreditCheck,
    mediaData
  } = params;

  const effectiveContext = clientContext && clientContext.source ? { ...clientContext } : { ...(clientContext || {}) };

  // 1. Hidratar Bloques de Memoria Jerárquica (Patrón Letta / MemGPT) + Promociones Activas
  const coreMemory = await hydrateCoreMemory({
    message,
    history,
    clientContext: effectiveContext,
    senderNumber: senderNumber || senderJid
  });

  // Persistir CoreMemory en MongoDB (no bloqueante)
  persistCoreMemoryAsync(conversationId, senderNumber || senderJid, coreMemory);

  // 2. Construir System Prompt Modular con CoreMemoryBlocks, Gatekeeper y Promociones
  const systemPrompt = buildModularSystemPrompt(coreMemory, effectiveContext.source || "TEMP_SESSION");

  // 3. Construir las StructuredTools validadas con Zod
  const structuredTools = buildBotStructuredTools({
    conversationId,
    senderNumber,
    senderJid,
    effectiveContext,
    onDeferredCreditCheck
  });
  const toolMap = new Map<string, any>();
  for (const t of structuredTools) {
    toolMap.set(t.name, t);
  }

  // 4. Preparar historial reciente (Recall Memory - últimos 8 mensajes) + mensaje actual (con soporte multimodal Audio/Imagen)
  const trimmedHistory = getSlidingWindowMessages(history, 8);
  const lcMessages: BaseMessage[] = [new SystemMessage(systemPrompt)];

  for (const h of trimmedHistory) {
    const txt = (typeof (h as any).text === "string" ? (h as any).text : (typeof (h as any).content === "string" ? (h as any).content : h.parts?.[0]?.text)) || "";
    if (!txt.trim()) continue;
    if (h.role === "model") {
      lcMessages.push(new AIMessage(txt));
    } else {
      lcMessages.push(new HumanMessage(txt));
    }
  }

  if (mediaData && mediaData.data && mediaData.mimeType) {
    lcMessages.push(
      new HumanMessage({
        content: [
          {
            type: "text",
            text: message || "El cliente envió este archivo multimedia (audio o imagen). Escúchalo/míralo y responde naturalmente."
          },
          {
            type: "media",
            mimeType: mediaData.mimeType,
            data: mediaData.data
          }
        ]
      })
    );
  } else {
    lcMessages.push(new HumanMessage(message));
  }

  // 5. Inicializar Modelos en Cadena con Fallback (@langchain/google-genai) y Observabilidad (@langfuse/langchain)
  const apiKey = getGeminiApiKey();
  const primaryLlm = new ChatGoogleGenerativeAI({
    apiKey,
    model: process.env.GEMINI_PRIMARY_MODEL || "gemini-2.5-flash",
    temperature: 0.2,
    maxRetries: 2
  });

  const fallbackLlm = new ChatGoogleGenerativeAI({
    apiKey,
    model: process.env.GEMINI_FALLBACK_MODEL || "gemini-2.0-flash",
    temperature: 0.2,
    maxRetries: 2
  });

  const llmWithTools = primaryLlm.bindTools(structuredTools).withFallbacks({
    fallbacks: [fallbackLlm.bindTools(structuredTools)]
  });
  const llmTextOnly = primaryLlm.withFallbacks({
    fallbacks: [fallbackLlm]
  });

  const callbacks = createLangfuseCallbacks({
    conversationId,
    userId: senderNumber || senderJid,
    channel: senderJid.startsWith("instagram:")
      ? "INSTAGRAM"
      : senderJid.startsWith("facebook:")
      ? "FACEBOOK"
      : "WHATSAPP",
    businessLine: coreMemory.activeDeal.businessLine
  });

  // 6. Bucle de Ejecución de Agente Multi-Turno (MAX_TOOL_TURNS = 3)
  const MAX_TOOL_TURNS = 3;
  let finalContent = "";
  let toolsExecutedCount = 0;
  let lastExecutedToolName = "";

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const allowTools = turn < MAX_TOOL_TURNS - 1;
    const executor = allowTools ? llmWithTools : llmTextOnly;

    const aiResponse = (await executor.invoke(lcMessages, {
      callbacks: callbacks.length > 0 ? callbacks : undefined
    })) as AIMessage;

    lcMessages.push(aiResponse);

    const extractedText = extractTextFromAIMessage(aiResponse);
    if (extractedText) {
      finalContent = extractedText;
    }

    const toolCalls = aiResponse.tool_calls || [];
    if (!allowTools || toolCalls.length === 0) {
      break;
    }

    for (const tc of toolCalls) {
      const toolName = tc.name;
      const toolArgs = tc.args || {};
      const toolId = tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      lastExecutedToolName = toolName;
      toolsExecutedCount++;

      console.log(`[LangChain Agent] Executing Tool: ${toolName}`, toolArgs);

      const targetTool = toolMap.get(toolName);
      let toolOutputStr = "";
      if (targetTool) {
        try {
          const rawOut = await targetTool.invoke(toolArgs);
          toolOutputStr = typeof rawOut === "string" ? rawOut : JSON.stringify(rawOut);
        } catch (toolErr: any) {
          console.error(`[LangChain Agent] Error en tool ${toolName}: ${toolErr.message}`);
          toolOutputStr = JSON.stringify({ status: "error", message: toolErr.message });
        }
      } else {
        toolOutputStr = JSON.stringify({ status: "error", message: `Herramienta desconocida: ${toolName}` });
      }

      lcMessages.push(
        new ToolMessage({
          tool_call_id: toolId,
          name: toolName,
          content: toolOutputStr
        })
      );
    }
  }

  // 7. Fallback conversacional anti-vacío si el modelo solo ejecutó herramientas sin emitir texto final
  if (!finalContent || finalContent.trim().length === 0) {
    console.warn(
      `[ManuelBotardo Agent] Respuesta vacía tras ${toolsExecutedCount} herramientas (última: ${lastExecutedToolName}). Aplicando fallback conversacional.`
    );
    if (lastExecutedToolName.includes("Credito") || lastExecutedToolName.includes("Financing")) {
      finalContent =
        "Ya puse en marcha la consulta crediticia en el sistema. Mientras aguardamos la respuesta del evaluador, ¿qué modelo de moto te gustaría consultar o qué cilindrada estás buscando?";
    } else if (
      lastExecutedToolName.includes("taller") ||
      lastExecutedToolName.includes("repuesto") ||
      lastExecutedToolName.includes("Appointment")
    ) {
      finalContent =
        "Perfecto, ya registré tu consulta para el sector de taller y repuestos. Un asesor de servicio se pondrá en contacto con vos a la brevedad.";
    } else if (lastExecutedToolName === "guardar_datos_usuario" || lastExecutedToolName.includes("lead")) {
      finalContent =
        "Entendido, ya registré tus datos. ¿En qué modelo de moto estás interesado o te gustaría conocer las opciones de financiación?";
    } else {
      finalContent = "Entendido. ¿En qué modelo de moto te gustaría que te asesore o cómo te gustaría financiarla?";
    }
  }

  const userLines = (message || "")
    .split(/\n|\s+\|\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const userParts =
    userLines.length > 0
      ? userLines.map((line) => ({ role: "user", parts: [{ text: line }] }))
      : [{ role: "user", parts: [{ text: message }] }];

  const updatedHistory = [...history, ...userParts, { role: "model", parts: [{ text: finalContent }] }];

  return {
    text: finalContent,
    newHistory: updatedHistory.slice(-20)
  };
}
