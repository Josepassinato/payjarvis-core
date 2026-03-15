import { GoogleGenerativeAI, SchemaType, type FunctionDeclarationSchema } from "@google/generative-ai";

function buildDefaultPrompt(ownerName: string, botName: string, capabilities: string[], language: string, amazonDomain?: string): string {
  const capList = capabilities.length > 0
    ? `\n\nYour capabilities:\n${capabilities.map(c => `- ${c}`).join("\n")}`
    : "";

  return `You are ${botName}, a personal assistant for ${ownerName}.

You are intelligent, proactive, and discreet. You respond in ${language}.${capList}

Your personality:
- Trusted assistant — professional but approachable
- Direct and concise — no fluff
- Proactive — anticipate needs
${amazonDomain ? `\n\nWhen searching or linking to Amazon products, ALWAYS use https://www.${amazonDomain}. Never use a different Amazon domain unless the user explicitly requests it.` : ""}

When the user provides login credentials (email and password) for any store or service, use the save_store_credentials function to save them securely. NEVER repeat the password in your response — only confirm the email and store name.

When the user asks to remove or delete their login for a store, use the remove_store_credentials function.

Sign off as: ${botName}`;
}

const MAX_HISTORY = 10;
const MAX_RESPONSE_LENGTH = 4000;

interface HistoryEntry {
  role: "user" | "model";
  parts: { text: string }[];
}

const chatHistories = new Map<string, HistoryEntry[]>();

export interface ChatContext {
  botId: string;
  ownerName?: string;
  botName?: string;
  systemPrompt?: string;
  capabilities?: string[];
  language?: string;
  amazonDomain?: string;
}

export interface GeminiResult {
  text: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}

const saveCredentialsParams: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    store_name: { type: SchemaType.STRING, description: "Store name (e.g. Amazon, Macy's, Walmart, Target)" },
    email: { type: SchemaType.STRING, description: "Login email or username" },
    password: { type: SchemaType.STRING, description: "Login password" },
  },
  required: ["store_name", "email", "password"],
};

const removeCredentialsParams: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    store_name: { type: SchemaType.STRING, description: "Store name to remove credentials for" },
  },
  required: ["store_name"],
};

const credentialTools = [{
  functionDeclarations: [
    {
      name: "save_store_credentials",
      description: "Save store login credentials to the user's secure vault. Call this when the user provides their email/username and password for a store.",
      parameters: saveCredentialsParams,
    },
    {
      name: "remove_store_credentials",
      description: "Remove stored login credentials for a store from the user's vault. Call this when the user asks to delete or remove their login for a store.",
      parameters: removeCredentialsParams,
    },
  ],
}];

export async function chatWithGemini(chatId: string, userMessage: string, ctx: ChatContext): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: "Assistant unavailable. Visit https://www.payjarvis.com" };
  }

  const ownerName = ctx.ownerName || "the user";
  const botName = ctx.botName || "Assistant";
  const capabilities = ctx.capabilities || [];
  const language = ctx.language || "en";
  const amazonDomain = ctx.amazonDomain;

  // Use custom system prompt if provided, otherwise build default
  let systemPrompt: string;
  if (ctx.systemPrompt) {
    systemPrompt = ctx.systemPrompt;
    if (amazonDomain) {
      systemPrompt += `\n\nWhen searching or linking to Amazon products, ALWAYS use https://www.${amazonDomain}. Never use a different Amazon domain unless the user explicitly requests it.`;
    }
    // Append credential instructions to custom prompts too
    systemPrompt += `\n\nWhen the user provides login credentials (email and password) for any store or service, use the save_store_credentials function to save them securely. NEVER repeat the password in your response — only confirm the email and store name.\n\nWhen the user asks to remove or delete their login for a store, use the remove_store_credentials function.`;
  } else {
    systemPrompt = buildDefaultPrompt(ownerName, botName, capabilities, language, amazonDomain);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    tools: credentialTools,
  });

  // Key includes botId to isolate history per bot, not just per chat
  const historyKey = `${ctx.botId}:${chatId}`;
  const history = chatHistories.get(historyKey) ?? [];

  try {
    const chatSession = model.startChat({ history });
    const result = await chatSession.sendMessage(userMessage);
    const fnCalls = result.response.functionCalls();

    if (fnCalls && fnCalls.length > 0) {
      const fc = fnCalls[0];
      // Don't add to history yet — the webhook will handle the function call
      // and send the result back
      return {
        text: "",
        functionCall: { name: fc.name, args: fc.args as Record<string, unknown> },
      };
    }

    let response = result.response.text();

    // Truncate if too long for Telegram
    if (response.length > MAX_RESPONSE_LENGTH) {
      response = response.substring(0, MAX_RESPONSE_LENGTH - 20) + "\n\n[resposta truncada]";
    }

    // Update history
    history.push(
      { role: "user", parts: [{ text: userMessage }] },
      { role: "model", parts: [{ text: response }] }
    );

    // Keep only last N entries
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, history.length - MAX_HISTORY * 2);
    }

    chatHistories.set(historyKey, history);

    return { text: response };
  } catch (err) {
    console.error("[Gemini] Error:", err);
    return { text: "Erro ao processar sua mensagem. Tente novamente." };
  }
}
