import axios from "axios";
import { getBackendApiKey, getCleanBackendUrl, inferStateFromCity } from "../config/env";

export interface ICoreMemoryBlocks {
  customerIdentity: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    dni?: string;
    gender?: "M" | "F";
    city?: string;
    state?: string;
    phone?: string;
    isIdentityComplete: boolean;
    missingFields: string[];
  };
  activeDeal: {
    businessLine: "COMERCIAL" | "TALLER" | "INDEFINIDO";
    interestVehicle?: string;
    paymentMethod?: string;
    tradeIn?: boolean;
    usedVehicle?: {
      brand?: string;
      model?: string;
      year?: string;
      kilometers?: string;
    };
    creditStatus?: string;
    evaluatedGuarantors: Array<{
      dni: string;
      nombre?: string;
      parentesco?: string;
      genero?: string;
      aprobado?: boolean;
    }>;
    workshopServiceType?: "REPUESTOS" | "SERVICIO_TECNICO" | "REPARACION" | "GARANTIA";
  };
  conversationSummary: string;
  activePromotions: Array<{
    id: string;
    title: string;
    category: string;
    shortSummary: string;
    discountText?: string;
    applicableModels?: string[];
    applicableBranches?: string[];
  }>;
  updatedAt: Date;
}

// Caché en memoria de 45 segundos para promociones activas (evita sobrecargar MongoDB en ráfagas)
let cachedPromotions: any[] = [];
let lastPromotionsFetchMs = 0;
const PROMOTIONS_CACHE_TTL_MS = 45 * 1000;

export async function fetchActivePromotionsForBot(category?: string, forceRefresh = false): Promise<any[]> {
  const now = Date.now();
  if (!forceRefresh && !category && cachedPromotions.length > 0 && now - lastPromotionsFetchMs < PROMOTIONS_CACHE_TTL_MS) {
    return cachedPromotions;
  }

  try {
    const backendUrl = getCleanBackendUrl();
    const apiKey = getBackendApiKey();
    const res = await axios.get(`${backendUrl}/api/v1/crm/promotions/active-bot`, {
      params: category ? { category } : {},
      headers: { "x-api-key": apiKey },
      timeout: 5000
    });
    const list = Array.isArray(res.data?.data) ? res.data.data : [];
    if (!category) {
      cachedPromotions = list;
      lastPromotionsFetchMs = now;
    }
    return list;
  } catch {
    return cachedPromotions;
  }
}

/**
 * Construye un resumen compacto de los mensajes previos a la ventana deslizante de 8 turnos (Patrón Letta Recall -> Core Summary).
 * Así Manuel Botardo jamás sufre amnesia cuando la conversación supera los 8 mensajes.
 */
export function buildConversationSummary(history: any[], existingSummary?: string, windowSize = 8): string {
  if (!Array.isArray(history) || history.length <= windowSize) {
    return existingSummary || "Inicio de conversación reciente (todo el contexto está en los últimos mensajes).";
  }

  const olderMessages = history.slice(0, history.length - windowSize);
  const extractedFacts: string[] = [];

  for (const msg of olderMessages.slice(-14)) {
    const role = msg.role === "model" || msg.role === "assistant" ? "Bot" : "Cliente";
    const text = (typeof msg.text === "string" ? msg.text : msg.parts?.[0]?.text || "").trim();
    if (!text) continue;
    const compact = text.replace(/\s+/g, " ").slice(0, 140);
    extractedFacts.push(`[${role}]: ${compact}`);
  }

  if (extractedFacts.length === 0) {
    return existingSummary || "Conversación en curso.";
  }

  return extractedFacts.join(" | ");
}

/**
 * Detecta la línea de negocio predominante según el contexto y el último mensaje del usuario.
 */
export function detectBusinessLine(
  message: string,
  clientContext: any
): "COMERCIAL" | "TALLER" | "INDEFINIDO" {
  const lower = (message || "").toLowerCase();
  const workshopKeywords = [
    "repuesto",
    "accesorio",
    "casco",
    "indumentaria",
    "campera",
    "guante",
    "aceite",
    "filtro",
    "bateria",
    "batería",
    "cubierta",
    "cadena",
    "transmision",
    "transmisión",
    "pastilla",
    "freno",
    "embrague",
    "bulbo",
    "espejo",
    "optica",
    "óptica",
    "service",
    "taller",
    "turno",
    "mantenimiento",
    "garantia",
    "garantía",
    "reparacion",
    "reparación",
    "falla"
  ];

  if (workshopKeywords.some(k => lower.includes(k)) || clientContext?.businessLine === "TALLER") {
    return "TALLER";
  }
  if (clientContext?.interest || clientContext?.paymentMethod) {
    return "COMERCIAL";
  }
  return "COMERCIAL";
}

/**
 * Hidrata los 4 bloques de memoria jerárquica con estado (Patrón Letta / MemGPT) antes de ejecutar el grafo de agente.
 */
export async function hydrateCoreMemory(params: {
  message: string;
  history: any[];
  clientContext?: any;
  senderNumber?: string;
}): Promise<ICoreMemoryBlocks> {
  const { message, history, clientContext, senderNumber } = params;
  const ctx = clientContext || {};
  const prevCore: Partial<ICoreMemoryBlocks> = ctx.coreMemory || {};

  const rawFullName = (
    ctx.fullName ||
    [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") ||
    prevCore.customerIdentity?.fullName ||
    ""
  ).trim();
  const hasValidName = Boolean(rawFullName) && !rawFullName.toLowerCase().includes("sin nombre");

  const rawCity = (ctx.city || prevCore.customerIdentity?.city || "").trim();
  const hasCity = Boolean(rawCity);
  const inferredState = inferStateFromCity(rawCity, ctx.state || prevCore.customerIdentity?.state);

  const rawPhone = (ctx.phone || senderNumber || prevCore.customerIdentity?.phone || "").toString().trim();
  const hasPhone = Boolean(rawPhone);

  const missingFields: string[] = [];
  if (!hasValidName) missingFields.push("Nombre y Apellido completo");
  if (!hasCity) missingFields.push("Ciudad / Localidad de residencia");
  if (!hasPhone) missingFields.push("Número de Teléfono / WhatsApp de contacto");

  const activePromotionsRaw = await fetchActivePromotionsForBot();
  const activePromotions = activePromotionsRaw.map((p: any) => ({
    id: String(p._id || ""),
    title: p.title || "",
    category: p.category || "MOTOS",
    shortSummary: p.shortSummary || "",
    discountText: p.discountText || undefined,
    applicableModels: Array.isArray(p.applicableModels) ? p.applicableModels : [],
    applicableBranches: Array.isArray(p.applicableBranches) ? p.applicableBranches : ["TODAS"]
  }));

  const businessLine = detectBusinessLine(message, ctx);

  return {
    customerIdentity: {
      firstName: ctx.firstName || prevCore.customerIdentity?.firstName || undefined,
      lastName: ctx.lastName || prevCore.customerIdentity?.lastName || undefined,
      fullName: hasValidName ? rawFullName : undefined,
      dni: ctx.dni || prevCore.customerIdentity?.dni || undefined,
      gender: ctx.gender || prevCore.customerIdentity?.gender || undefined,
      city: hasCity ? rawCity : undefined,
      state: inferredState || undefined,
      phone: hasPhone ? rawPhone : undefined,
      isIdentityComplete: missingFields.length === 0,
      missingFields
    },
    activeDeal: {
      businessLine,
      interestVehicle: ctx.interest || prevCore.activeDeal?.interestVehicle || undefined,
      paymentMethod: ctx.paymentMethod || prevCore.activeDeal?.paymentMethod || undefined,
      tradeIn: ctx.tradeIn !== undefined && ctx.tradeIn !== null ? ctx.tradeIn : prevCore.activeDeal?.tradeIn,
      usedVehicle: ctx.usedVehicle || prevCore.activeDeal?.usedVehicle || undefined,
      creditStatus: ctx.leadStatus || prevCore.activeDeal?.creditStatus || "SIN LEAD ACTIVO",
      evaluatedGuarantors: Array.isArray(ctx.garantes)
        ? ctx.garantes
        : prevCore.activeDeal?.evaluatedGuarantors || []
    },
    conversationSummary: (() => {
      let sum = buildConversationSummary(history, prevCore.conversationSummary, 8);
      if ((!sum || sum.startsWith("Inicio de conversación reciente")) && (ctx.interest || ctx.source === 'LEAD_ACTIVO' || ctx.source === 'PREVIOUS_SESSION')) {
        const parts: string[] = [];
        if (ctx.interest) parts.push(`Consulta anterior de moto: ${ctx.interest}`);
        if (ctx.paymentMethod) parts.push(`Medio de pago previo: ${ctx.paymentMethod}`);
        if (ctx.leadStatus && ctx.leadStatus !== 'SIN LEAD ACTIVO') parts.push(`Estado del lead: ${ctx.leadStatus}`);
        if (parts.length > 0) {
          sum = `[Historial Previo del Cliente]: ${parts.join(" | ")}.`;
        }
      }
      return sum;
    })(),
    activePromotions,
    updatedAt: new Date()
  };
}

/**
 * Sanitiza valores de texto para prevenir inyecciones XML y ruptura de delimitadores en CoreMemory.
 */
export function sanitizeXmlText(val: any): string {
  if (val === null || val === undefined) return "null";
  const str = String(val).trim();
  if (!str) return "null";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Formatea los 4 bloques de Core Memory en XML estructurado estilo Letta/MemGPT para el System Prompt.
 */
export function renderCoreMemoryBlocksXml(memory: ICoreMemoryBlocks, source: string = "TEMP_SESSION"): string {
  const id = memory.customerIdentity;
  const deal = memory.activeDeal;

  let usedVehicleText = "null";
  if (deal.usedVehicle && (deal.usedVehicle.brand || deal.usedVehicle.model)) {
    const uv = deal.usedVehicle;
    usedVehicleText = sanitizeXmlText(`${uv.brand || ""} ${uv.model || ""} ${uv.year || ""} (${uv.kilometers || ""} km)`);
  } else if (deal.tradeIn) {
    usedVehicleText = "Sí (datos de Marca, Modelo, Año y Km pendientes)";
  }

  const guarantorsText =
    deal.evaluatedGuarantors && deal.evaluatedGuarantors.length > 0
      ? deal.evaluatedGuarantors
          .map(g => `${sanitizeXmlText(g.nombre || "Garante")} (DNI: ${sanitizeXmlText(g.dni)}, Parentesco: ${sanitizeXmlText(g.parentesco || "N/A")})`)
          .join("; ")
      : "Ninguno registrado";

  const promosText =
    memory.activePromotions && memory.activePromotions.length > 0
      ? memory.activePromotions
          .map(
            p =>
              `• [${sanitizeXmlText(p.category)}] ${sanitizeXmlText(p.title)}${p.discountText ? ` (${sanitizeXmlText(p.discountText)})` : ""}: ${sanitizeXmlText(p.shortSummary)}${
                p.applicableModels && p.applicableModels.length > 0 ? ` | Modelos: ${sanitizeXmlText(p.applicableModels.join(", "))}` : ""
              }`
          )
          .join("\n")
      : "No hay promociones especiales cargadas en este momento.";

  return `
<core_memory source="${sanitizeXmlText(source)}">
  <customer_identity_block>
    - Nombre Completo: ${sanitizeXmlText(id.fullName)}
    - Nombre: ${sanitizeXmlText(id.firstName)}
    - Apellido: ${sanitizeXmlText(id.lastName)}
    - Ciudad de Residencia: ${sanitizeXmlText(id.city)}
    - Provincia: ${sanitizeXmlText(id.state)}
    - Teléfono / WhatsApp: ${sanitizeXmlText(id.phone)}
    - DNI Titular: ${sanitizeXmlText(id.dni)}
    - Género: ${sanitizeXmlText(id.gender)}
    - Identidad Completa (Gatekeeper): ${id.isIdentityComplete ? "SÍ (Nombre, Ciudad y Teléfono verificados)" : `NO — Faltan: ${id.missingFields.map(f => sanitizeXmlText(f)).join(", ")}`}
  </customer_identity_block>
  <active_deal_block>
    - Línea de Negocio Detectada: ${sanitizeXmlText(deal.businessLine)}
    - Consulta Activa de Moto: ${sanitizeXmlText(deal.interestVehicle)}
    - Medio de Pago: ${sanitizeXmlText(deal.paymentMethod)}
    - Moto Usada en Parte de Pago (Permuta): ${usedVehicleText}
    - Garantes Evaluados: ${guarantorsText}
    - Estado Comercial: ${sanitizeXmlText(deal.creditStatus || "SIN LEAD ACTIVO")}
  </active_deal_block>
  <conversation_summary_block>
    ${sanitizeXmlText(memory.conversationSummary)}
  </conversation_summary_block>
  <active_promotions_block>
${promosText}
  </active_promotions_block>
</core_memory>`.trim();
}

/**
 * Persiste de forma no bloqueante el bloque coreMemory en whatsapp_conversations (MongoDB).
 */
export function persistCoreMemoryAsync(
  conversationId: string | undefined,
  phone: string,
  coreMemory: ICoreMemoryBlocks
): void {
  if (!conversationId && !phone) return;
  const backendUrl = getCleanBackendUrl();
  const apiKey = getBackendApiKey();

  const { activePromotions, ...persistedMemory } = coreMemory;

  axios
    .post(
      `${backendUrl}/api/v1/crm/chat/sync`,
      {
        conversationId,
        phone,
        coreMemory: persistedMemory
      },
      {
        headers: { "x-api-key": apiKey },
        timeout: 8000
      }
    )
    .catch(() => {});
}
