import { inferStateFromCity as inferState } from "../agent/config/env";
import { hydrateCoreMemory } from "../agent/memory/coreMemory";
import { buildModularSystemPrompt } from "../agent/prompts/promptBuilder";
import { getSlidingWindowMessages as getWindow, runManuelBotardoAgent } from "../agent/botAgent";

export const inferStateFromCity = inferState;
export const getSlidingWindowMessages = getWindow;

export async function buildDynamicSystemInstruction(clientContext: any): Promise<string> {
  const coreMemory = await hydrateCoreMemory({
    message: "",
    history: [],
    clientContext
  });
  return buildModularSystemPrompt(coreMemory, clientContext?.source || "TEMP_SESSION");
}

export class GeminiService {
  async chat(
    message: string,
    history: any[] = [],
    senderNumber: string = "",
    senderJid: string = "",
    clientContext?: any,
    conversationId?: string,
    leadContextText?: string,
    onDeferredCreditCheck?: (data: {
      jid: string;
      senderNumber: string;
      dni: string;
      gender: string;
      conversationId?: string;
      isGuarantor?: boolean;
      guarantorName?: string;
      relationship?: string;
    }) => void,
    mediaData?: { data: string; mimeType: string }
  ) {
    return await runManuelBotardoAgent({
      message,
      history,
      senderNumber,
      senderJid,
      clientContext,
      conversationId,
      leadContextText,
      onDeferredCreditCheck,
      mediaData
    });
  }
}

export default new GeminiService();
