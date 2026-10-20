/**
 * Capa 4: Observabilidad LLM con @langfuse/langchain (Fail-Safe).
 * Lee exclusivamente variables de entorno (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL).
 * Si no están configuradas en .env, retorna un arreglo vacío sin bloquear la ejecución del bot.
 */
export function createLangfuseCallbacks(meta: {
  conversationId?: string;
  userId?: string;
  channel?: string;
  businessLine?: string;
}): any[] {
  const publicKey = (process.env.LANGFUSE_PUBLIC_KEY || "").trim();
  const secretKey = (process.env.LANGFUSE_SECRET_KEY || "").trim();
  const baseUrl = (process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST || "https://cloud.langfuse.com").trim();

  if (!publicKey || !secretKey) {
    return [];
  }

  try {
    // Carga dinámica segura para evitar fallos si el entorno no tiene configuradas las claves
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CallbackHandler } = require("@langfuse/langchain");
    const handler = new CallbackHandler({
      publicKey,
      secretKey,
      baseUrl,
      sessionId: meta.conversationId || undefined,
      userId: meta.userId || undefined,
      tags: [meta.channel || "WHATSAPP", meta.businessLine || "COMERCIAL", "manuel-botardo"]
    });
    return [handler];
  } catch (err: any) {
    console.warn(`[Langfuse Observability] Aviso no bloqueante al inicializar CallbackHandler: ${err.message}`);
    return [];
  }
}
