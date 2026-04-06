/**
 * Vision Fallback Service — Multi-provider image analysis
 *
 * Chain: Gemini 2.5 Flash -> GPT-4o -> Claude Sonnet
 * Each provider is skipped if its API key is not configured.
 * Gemini is primary (already works). Others activate when keys are added to .env.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

export interface VisionResult {
  success: boolean;
  text: string;
  provider: string;
  durationMs: number;
  fallbackUsed: boolean;
}

interface VisionProvider {
  name: string;
  available: boolean;
  timeout: number;
  priority: number;
  handler: (imageBase64: string, mimeType: string, prompt: string) => Promise<string>;
}

// --- Provider Handlers ---

async function processWithGemini(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const result = await model.generateContent([
    { inlineData: { mimeType, data: imageBase64 } },
    { text: prompt },
  ]);

  return result.response.text();
}

async function processWithOpenAI(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  const apiKey = OPENAI_API_KEY || OPENROUTER_API_KEY;
  const baseUrl = OPENAI_API_KEY ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1";
  const model = OPENAI_API_KEY ? "gpt-4o" : "openai/gpt-4o";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: "text", text: prompt },
        ],
      }],
      max_tokens: 1000,
    }),
    signal: AbortSignal.timeout(20000),
  });

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const errorObj = data.error as Record<string, unknown> | undefined;
    throw new Error((errorObj?.message as string) || `HTTP ${response.status}`);
  }
  const choices = data.choices as Array<{ message: { content: string } }>;
  return choices[0].message.content;
}

async function processWithClaude(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const errorObj = data.error as Record<string, unknown> | undefined;
    throw new Error((errorObj?.message as string) || `HTTP ${response.status}`);
  }
  const content = data.content as Array<{ text: string }>;
  return content[0].text;
}

// --- Main Fallback Function ---

export async function processVisionWithFallback(
  imageBase64: string,
  mimeType: string,
  userPrompt: string,
  userId: string,
): Promise<VisionResult> {
  const startTime = Date.now();

  const providers: VisionProvider[] = [
    {
      name: "gemini-2.5-flash",
      available: !!GEMINI_API_KEY,
      timeout: 15000,
      priority: 1,
      handler: processWithGemini,
    },
    {
      name: "gpt-4o",
      available: !!(OPENAI_API_KEY || OPENROUTER_API_KEY),
      timeout: 20000,
      priority: 2,
      handler: processWithOpenAI,
    },
    {
      name: "claude-sonnet",
      available: !!ANTHROPIC_API_KEY,
      timeout: 20000,
      priority: 3,
      handler: processWithClaude,
    },
  ];

  const errors: Array<{ provider: string; error: string; duration: number }> = [];

  for (const provider of providers) {
    if (!provider.available) {
      console.log(`[VISION] Skipping ${provider.name} -- not configured`);
      continue;
    }

    const attemptStart = Date.now();
    try {
      const text = await Promise.race([
        provider.handler(imageBase64, mimeType, userPrompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), provider.timeout)
        ),
      ]);

      const duration = Date.now() - attemptStart;
      const fallbackUsed = provider.priority > 1;

      if (fallbackUsed) {
        console.warn(`[VISION] Primary failed, succeeded with ${provider.name} (${duration}ms)`);
      } else {
        console.log(`[VISION] ${provider.name} OK (${duration}ms)`);
      }

      return {
        success: true,
        text,
        provider: provider.name,
        durationMs: duration,
        fallbackUsed,
      };
    } catch (error) {
      const duration = Date.now() - attemptStart;
      const errorMsg = error instanceof Error ? error.message : "unknown";
      errors.push({ provider: provider.name, error: errorMsg, duration });
      console.error(`[VISION] ${provider.name} failed (${duration}ms): ${errorMsg}`);
      continue;
    }
  }

  // ALL failed
  console.error(`[VISION] ALL providers failed for user ${userId}`, errors);

  const timeoutCount = errors.filter((e) => e.error === "TIMEOUT").length;
  const rateLimitCount = errors.filter((e) =>
    e.error.includes("429") || e.error.includes("RESOURCE_EXHAUSTED")
  ).length;

  let fallbackMessage: string;
  if (timeoutCount > errors.length / 2) {
    fallbackMessage = "A imagem ta demorando pra processar. Pode mandar de novo ou me dizer o nome do produto?";
  } else if (rateLimitCount > 0) {
    fallbackMessage = "To processando muitas imagens agora! Me manda o nome do produto que eu busco na hora.";
  } else {
    fallbackMessage = "To com dificuldade pra analisar essa imagem agora. Pode me descrever o produto ou mandar o link?";
  }

  return {
    success: false,
    text: fallbackMessage,
    provider: "none",
    durationMs: Date.now() - startTime,
    fallbackUsed: true,
  };
}
