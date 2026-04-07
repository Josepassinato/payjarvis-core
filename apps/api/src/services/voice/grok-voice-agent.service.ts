/**
 * Grok Voice Agent Service — Real-time voice AI via xAI WebSocket + Twilio
 *
 * Connects Twilio MediaStream (phone call audio) bidirectionally with the
 * xAI Grok Voice Agent API (wss://api.x.ai/v1/realtime).
 *
 * Native tools configured:
 * 1. web_search  — Real-time web search during calls (xAI server-side)
 * 2. x_search    — X/Twitter search for reviews/opinions (xAI server-side)
 * 3. MCP         — PayJarvis tools (search, compare, track) via MCP endpoint
 * 4. Custom functions — end_call_summary, transfer_to_human (client-side)
 *
 * Audio: PCMU (G.711 μ-law, 8kHz) — native Twilio format, zero transcoding.
 *
 * Flow:
 *   Twilio call → TwiML <Connect><Stream> → WS /api/voice/agent/stream/:callId
 *   → this service bridges audio between Twilio WS ↔ xAI WS
 */

import WebSocket from "ws";
import crypto from "crypto";
import Twilio from "twilio";
import { prisma } from "@payjarvis/database";
import { redisSet, redisGet, redisDel } from "../redis.js";
import { consumeMessage } from "../credit.service.js";

// ─── Config ──────────────────────────────────────────

const XAI_API_KEY = process.env.XAI_API_KEY || "";
const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const DEFAULT_FROM = process.env.TWILIO_VOICE_NUMBER || "+17547145921";
const BR_FROM = process.env.TWILIO_VOICE_NUMBER_BR || "+551150395940";
const BASE_URL = process.env.PAYJARVIS_PUBLIC_URL || "https://www.payjarvis.com";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";
const MCP_TOKEN = process.env.MCP_INTERNAL_TOKEN || process.env.INTERNAL_SECRET || "";
const CREDITS_PER_MINUTE = 15; // voice agent is more expensive (tools + voice)

// ─── Voice Options ───────────────────────────────────

export type GrokVoice = "ara" | "rex" | "eve" | "sal" | "leo";

const VOICE_DESCRIPTIONS: Record<GrokVoice, string> = {
  ara: "Warm, friendly — default Sniffer voice",
  rex: "Confident, professional — business calls",
  eve: "Energetic, upbeat — sales and engagement",
  sal: "Smooth, balanced — versatile",
  leo: "Authoritative — instructional",
};

// ─── Sniffer System Prompt ───────────────────────────

function buildSnifferInstructions(opts: {
  language?: string;
  userName?: string;
  objective?: string;
  businessName?: string;
  callerIdentity?: string;
}): string {
  const lang = opts.language || "en";
  const isPortuguese = lang.startsWith("pt");

  if (isPortuguese) {
    return `Você é o Sniffer 🐕, agente de compras inteligente do SnifferShop. Está em uma ligação telefônica em tempo real.

IDENTIDADE: ${opts.callerIdentity || `Assistente pessoal de ${opts.userName || "o usuário"}`}
${opts.objective ? `OBJETIVO DA LIGAÇÃO: ${opts.objective}` : ""}
${opts.businessName ? `LIGANDO PARA: ${opts.businessName}` : ""}

PERSONALIDADE:
- Fale como um amigo brasileiro: casual, rápido, com contrações ("tô", "vou", "beleza", "pera aí", "deixa comigo")
- Respostas CURTAS — máximo 2 frases por vez (é voz, não texto)
- Sempre dê feedback imediato antes de buscar algo: "Pera aí, vou dar uma olhada..."
- Seja animado com bons deals e sincero quando não vale a pena

FERRAMENTAS DISPONÍVEIS:
- Você pode buscar na web em tempo real (web_search) — use quando precisar de preços, disponibilidade, informações atuais
- Você pode buscar no X/Twitter (x_search) — use para reviews, opiniões, reclamações sobre produtos/serviços
- Você pode buscar produtos, hotéis, voos, eventos, restaurantes e rastrear encomendas via ferramentas MCP do Sniffer
- SEMPRE avise o usuário antes de buscar: "Deixa eu verificar isso pra você..."

REGRAS:
- NUNCA decida pelo usuário em questões de dinheiro — apresente opções
- Se o assunto for sensível (reclamação formal, problema legal), use transfer_to_human
- Ao encerrar, use end_call_summary para enviar resumo ao dono`;
  }

  return `You are Sniffer 🐕, the intelligent shopping agent from SnifferShop. You're on a live phone call in real-time.

IDENTITY: ${opts.callerIdentity || `Personal assistant for ${opts.userName || "the user"}`}
${opts.objective ? `CALL OBJECTIVE: ${opts.objective}` : ""}
${opts.businessName ? `CALLING: ${opts.businessName}` : ""}

PERSONALITY:
- Speak naturally, like a friendly and helpful assistant
- Keep responses SHORT — max 2 sentences at a time (this is voice, not text)
- Always give immediate feedback before searching: "Let me look that up for you..."
- Be enthusiastic about good deals and honest when something isn't worth it

TOOLS AVAILABLE:
- You can search the web in real-time (web_search) — use for current prices, availability, info
- You can search X/Twitter (x_search) — use for reviews, opinions, complaints about products/services
- You can search products, hotels, flights, events, restaurants and track packages via Sniffer MCP tools
- ALWAYS tell the user before searching: "Let me check that for you..."

RULES:
- NEVER make financial decisions for the user — present options
- If the topic is sensitive (formal complaint, legal issue), use transfer_to_human
- When ending the call, use end_call_summary to send a summary to the owner`;
}

// ─── Custom Function Definitions ─────────────────────

const CUSTOM_FUNCTIONS = [
  {
    type: "function" as const,
    name: "end_call_summary",
    description: "End the call and send a summary of the conversation to the bot owner via WhatsApp/Telegram. Use when the call is wrapping up.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Brief summary of what was discussed and decided" },
        actionItems: {
          type: "array",
          items: { type: "string" },
          description: "List of action items or next steps from the call",
        },
        foundDeals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              product: { type: "string" },
              price: { type: "string" },
              store: { type: "string" },
              url: { type: "string" },
            },
          },
          description: "Products/deals found during the call",
        },
      },
      required: ["summary"],
    },
  },
  {
    type: "function" as const,
    name: "transfer_to_human",
    description: "Transfer the call to the human owner when the topic is sensitive, the user explicitly requests a human, or the issue requires human judgment.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why the call is being transferred" },
      },
      required: ["reason"],
    },
  },
];

// ─── Session Management ──────────────────────────────

export interface VoiceAgentCallConfig {
  userId: string;
  to: string;
  businessName?: string;
  objective?: string;
  language?: string;
  voice?: GrokVoice;
  callerIdentity?: string;
  userName?: string;
  channel?: string;
}

interface ActiveSession {
  callId: string;
  userId: string;
  xaiWs: WebSocket | null;
  streamSid: string | null;
  sessionReady: boolean;
  turnCount: number;
  startedAt: number;
  transcript: Array<{ role: string; text: string; timestamp: number }>;
  config: VoiceAgentCallConfig;
}

const activeSessions = new Map<string, ActiveSession>();

// ─── Initiate Call via Twilio ────────────────────────

export async function initiateVoiceAgentCall(config: VoiceAgentCallConfig): Promise<{
  callId: string;
  callSid: string;
  status: string;
}> {
  if (!XAI_API_KEY) throw new Error("XAI_API_KEY not configured");
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) throw new Error("Twilio credentials not configured");

  // Resolve user
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { telegramChatId: config.userId },
        { phone: config.userId.replace("whatsapp:", "") },
        { id: config.userId },
        { clerkId: config.userId },
      ],
    },
    select: { id: true, planType: true, phone: true },
  });

  if (!user) throw new Error("User not found");

  // Check credits
  const creditCheck = await consumeMessage(user.id, "voice_agent", 0, 0);
  if (!creditCheck.allowed) throw new Error("Insufficient credits for voice agent call");

  // Rate limit: check daily usage
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dailyCount = await prisma.voiceCall.count({
    where: {
      userId: user.id,
      createdAt: { gte: today },
    },
  });
  const limit = user.planType === "PREMIUM" ? 20 : 5;
  if (dailyCount >= limit) throw new Error(`Daily voice agent call limit reached (${limit}/day)`);

  const callId = `vag_${crypto.randomBytes(12).toString("hex")}`;

  // Determine From number based on destination
  const to = config.to.replace(/\s/g, "");
  const fromNumber = to.startsWith("+55") ? BR_FROM : DEFAULT_FROM;

  // Create VoiceCall record
  await prisma.voiceCall.create({
    data: {
      id: callId,
      userId: user.id,
      callSid: callId, // temporary, updated when Twilio assigns real SID
      to,
      from: fromNumber,
      businessName: config.businessName || "",
      objective: config.objective || "Voice agent call",
      status: "initiating",
      channel: config.channel || "voice_agent",
      briefing: {
        type: "grok_voice_agent",
        language: config.language || "en",
        voice: config.voice || "ara",
        callerIdentity: config.callerIdentity,
        userName: config.userName,
      },
    },
  });

  // Store session config in Redis for when the stream connects
  await redisSet(
    `voice-agent:${callId}`,
    JSON.stringify({
      ...config,
      userId: user.id,
      voice: config.voice || "ara",
    }),
    600 // 10 min TTL
  );

  // Initiate Twilio call with TwiML pointing to our stream endpoint
  const client = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const call = await client.calls.create({
    to,
    from: fromNumber,
    twiml: `<Response><Connect><Stream url="wss://${BASE_URL.replace(/^https?:\/\//, "")}/api/voice/agent/stream/${callId}" /></Connect></Response>`,
    statusCallback: `${BASE_URL}/api/voice/agent/status/${callId}`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    machineDetection: "DetectMessageEnd",
    asyncAmd: "true",
    timeout: 30,
  });

  // Update with real Twilio SID
  await prisma.voiceCall.update({
    where: { id: callId },
    data: { callSid: call.sid, status: "ringing" },
  });

  console.log(`[VOICE-AGENT] Call initiated: ${callId} → ${to} (SID: ${call.sid})`);

  return { callId, callSid: call.sid, status: "ringing" };
}

// ─── Handle Twilio MediaStream WebSocket ─────────────

export async function handleMediaStream(
  twilioWs: WebSocket,
  callId: string,
): Promise<void> {
  console.log(`[VOICE-AGENT] [${callId}] MediaStream connected`);

  // Load config from Redis
  const configRaw = await redisGet(`voice-agent:${callId}`);
  if (!configRaw) {
    console.error(`[VOICE-AGENT] [${callId}] No config found in Redis`);
    twilioWs.close();
    return;
  }

  const config: VoiceAgentCallConfig = JSON.parse(configRaw);

  const session: ActiveSession = {
    callId,
    userId: config.userId,
    xaiWs: null,
    streamSid: null,
    sessionReady: false,
    turnCount: 0,
    startedAt: Date.now(),
    transcript: [],
    config,
  };

  activeSessions.set(callId, session);

  // Handle Twilio start event — get streamSid
  twilioWs.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.event === "start") {
        session.streamSid = msg.start.streamSid;
        console.log(`[VOICE-AGENT] [${callId}] Twilio stream started (SID: ${session.streamSid})`);

        // Now connect to xAI
        connectToXai(session, twilioWs).catch((err) => {
          console.error(`[VOICE-AGENT] [${callId}] Failed to connect xAI:`, err.message);
          twilioWs.close();
        });
      } else if (msg.event === "media" && msg.media?.track === "inbound") {
        // Forward caller audio to xAI
        if (session.xaiWs && session.sessionReady && session.xaiWs.readyState === WebSocket.OPEN) {
          session.xaiWs.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: msg.media.payload,
          }));
        }
      } else if (msg.event === "stop") {
        console.log(`[VOICE-AGENT] [${callId}] Twilio stream stopped`);
        cleanupSession(callId);
      }
    } catch {
      // ignore parse errors
    }
  });

  twilioWs.on("close", () => {
    console.log(`[VOICE-AGENT] [${callId}] Twilio WS closed`);
    cleanupSession(callId);
  });
}

// ─── Connect to xAI Realtime WebSocket ───────────────

async function connectToXai(session: ActiveSession, twilioWs: WebSocket): Promise<void> {
  const { callId, config } = session;

  const xaiWs = new WebSocket(XAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  session.xaiWs = xaiWs;

  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      xaiWs.close();
      reject(new Error("xAI WebSocket connection timeout"));
    }, 10_000);

    xaiWs.on("open", () => {
      clearTimeout(timeout);
      console.log(`[VOICE-AGENT] [${callId}] xAI WebSocket connected`);
      resolve();
    });

    xaiWs.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Handle xAI messages
  xaiWs.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      handleXaiMessage(session, twilioWs, msg);
    } catch (err) {
      console.error(`[VOICE-AGENT] [${callId}] Error parsing xAI message:`, (err as Error).message);
    }
  });

  xaiWs.on("close", (code) => {
    console.log(`[VOICE-AGENT] [${callId}] xAI WS closed (code: ${code})`);
  });

  xaiWs.on("error", (err) => {
    console.error(`[VOICE-AGENT] [${callId}] xAI WS error:`, err.message);
  });

  // xAI sends conversation.created first, then we send session.update
  // The session.update is sent in handleXaiMessage when we receive conversation.created
}

// ─── Handle Messages from xAI ────────────────────────

function handleXaiMessage(
  session: ActiveSession,
  twilioWs: WebSocket,
  msg: any,
): void {
  const { callId, config } = session;
  const xaiWs = session.xaiWs!;

  // Skip logging audio deltas (too noisy)
  if (msg.type !== "response.output_audio.delta" && msg.type !== "input_audio_buffer.append") {
    console.log(`[VOICE-AGENT] [${callId}] ${msg.type}`);
  }

  switch (msg.type) {
    // ─── Connection established, send session config ─────
    case "conversation.created": {
      const voice = (config.voice || "ara") as GrokVoice;
      const instructions = buildSnifferInstructions(config);

      const sessionUpdate = {
        type: "session.update",
        session: {
          instructions,
          voice,
          turn_detection: {
            type: "server_vad",
            threshold: 0.85,
            silence_duration_ms: 500,
            prefix_padding_ms: 333,
          },
          audio: {
            input: { format: { type: "audio/pcmu" } },
            output: { format: { type: "audio/pcmu" } },
          },
          tools: [
            // Tool 1: Web Search (xAI server-side, zero config)
            { type: "web_search" },

            // Tool 2: X/Twitter Search (xAI server-side)
            { type: "x_search" },

            // Tool 3: PayJarvis MCP — all Sniffer commerce tools
            {
              type: "mcp",
              server_url: `${BASE_URL}/mcp`,
              server_label: "sniffer-tools",
              server_description: "Sniffer shopping agent tools — search products, hotels, flights, events, restaurants, compare prices, track packages",
              authorization: `Bearer ${MCP_TOKEN}`,
            },

            // Tool 4 & 5: Custom functions (client-side)
            ...CUSTOM_FUNCTIONS,
          ],
        },
      };

      xaiWs.send(JSON.stringify(sessionUpdate));
      console.log(`[VOICE-AGENT] [${callId}] Session config sent (voice: ${voice}, tools: 5)`);
      break;
    }

    // ─── Session configured, send initial greeting ───────
    case "session.updated": {
      session.sessionReady = true;

      // Trigger Sniffer to greet first
      xaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: config.objective
              ? `You just connected to ${config.businessName || "the recipient"}. Greet them and introduce yourself, then work towards: ${config.objective}`
              : "You just connected to a phone call. Greet the person warmly and ask how you can help them today.",
          }],
        },
      }));

      xaiWs.send(JSON.stringify({ type: "response.create" }));
      console.log(`[VOICE-AGENT] [${callId}] Session ready, greeting triggered`);
      break;
    }

    // ─── Audio from xAI → Twilio (Sniffer speaking) ─────
    case "response.output_audio.delta": {
      if (msg.delta && session.streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({
          event: "media",
          streamSid: session.streamSid,
          media: { payload: msg.delta },
        }));
      }
      break;
    }

    // ─── Barge-in: caller interrupted Sniffer ────────────
    case "input_audio_buffer.speech_started": {
      if (session.streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({
          event: "clear",
          streamSid: session.streamSid,
        }));
      }
      break;
    }

    // ─── Turn tracking ───────────────────────────────────
    case "response.created": {
      session.turnCount++;
      break;
    }

    // ─── Transcript logging ──────────────────────────────
    case "response.output_audio_transcript.delta": {
      if (msg.delta) {
        // Accumulate bot speech (streamed word by word)
        const last = session.transcript[session.transcript.length - 1];
        if (last && last.role === "assistant") {
          last.text += msg.delta;
        } else {
          session.transcript.push({ role: "assistant", text: msg.delta, timestamp: Date.now() });
        }
      }
      break;
    }

    case "conversation.item.input_audio_transcription.completed": {
      if (msg.transcript) {
        session.transcript.push({ role: "user", text: msg.transcript, timestamp: Date.now() });
        console.log(`[VOICE-AGENT] [${callId}] User: "${msg.transcript.substring(0, 100)}"`);
      }
      break;
    }

    // ─── Custom function call handling ───────────────────
    case "response.output_item.done": {
      if (msg.item?.type === "function_call") {
        handleFunctionCall(session, twilioWs, msg.item).catch((err) => {
          console.error(`[VOICE-AGENT] [${callId}] Function call error:`, err.message);
        });
      }
      break;
    }

    // ─── Errors ──────────────────────────────────────────
    case "error": {
      console.error(`[VOICE-AGENT] [${callId}] xAI error:`, msg.error?.message || JSON.stringify(msg));
      break;
    }
  }
}

// ─── Handle Custom Function Calls ────────────────────

async function handleFunctionCall(
  session: ActiveSession,
  twilioWs: WebSocket,
  item: { name: string; call_id: string; arguments?: string },
): Promise<void> {
  const { callId, userId, config } = session;
  const xaiWs = session.xaiWs!;

  let args: Record<string, any> = {};
  try {
    args = JSON.parse(item.arguments || "{}");
  } catch {
    // ignore parse errors
  }

  console.log(`[VOICE-AGENT] [${callId}] Function: ${item.name}(${JSON.stringify(args).substring(0, 200)})`);

  let result: string;

  switch (item.name) {
    case "end_call_summary": {
      // Send summary to user via Telegram/WhatsApp
      const summary = args.summary || "Call ended.";
      const actionItems = args.actionItems || [];
      const foundDeals = args.foundDeals || [];

      let message = `📞 *Resumo da Ligação Sniffer*\n\n${summary}`;

      if (actionItems.length > 0) {
        message += "\n\n📋 *Próximos passos:*\n" + actionItems.map((a: string) => `• ${a}`).join("\n");
      }

      if (foundDeals.length > 0) {
        message += "\n\n🏷️ *Ofertas encontradas:*\n" +
          foundDeals.map((d: any) => `• ${d.product} — ${d.price} (${d.store})`).join("\n");
      }

      // Send via internal notification
      try {
        await fetch(`http://localhost:${process.env.API_PORT || 3001}/api/notifications/telegram`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": INTERNAL_SECRET,
          },
          body: JSON.stringify({ userId, message }),
        });
      } catch {
        // notification failure is non-blocking
      }

      // Save call result
      await prisma.voiceCall.update({
        where: { id: callId },
        data: {
          result: summary,
          transcript: session.transcript as any,
        },
      }).catch(() => {});

      result = JSON.stringify({ success: true, message: "Summary sent to owner" });
      break;
    }

    case "transfer_to_human": {
      const reason = args.reason || "User requested human assistance";

      // Notify owner about transfer request
      try {
        await fetch(`http://localhost:${process.env.API_PORT || 3001}/api/notifications/telegram`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": INTERNAL_SECRET,
          },
          body: JSON.stringify({
            userId,
            message: `🔄 *Transferência de Ligação*\n\nO Sniffer precisa transferir uma chamada para você.\n\nMotivo: ${reason}\n\nLigue de volta para: ${config.to || "número da ligação"}`,
          }),
        });
      } catch {
        // non-blocking
      }

      result = JSON.stringify({
        success: true,
        message: "Transfer request sent. Tell the caller that the owner has been notified and will call back shortly.",
      });
      break;
    }

    default:
      result = JSON.stringify({ error: `Unknown function: ${item.name}` });
  }

  // Send function result back to xAI
  xaiWs.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: item.call_id,
      output: result,
    },
  }));

  // Continue the conversation
  xaiWs.send(JSON.stringify({ type: "response.create" }));
}

// ─── Session Cleanup ─────────────────────────────────

async function cleanupSession(callId: string): Promise<void> {
  const session = activeSessions.get(callId);
  if (!session) return;

  // Close xAI WebSocket
  if (session.xaiWs && session.xaiWs.readyState !== WebSocket.CLOSED) {
    session.xaiWs.close();
  }

  // Calculate duration and bill
  const durationMs = Date.now() - session.startedAt;
  const minutes = Math.max(1, Math.ceil(durationMs / 60_000));
  const credits = minutes * CREDITS_PER_MINUTE;

  // Update VoiceCall record
  await prisma.voiceCall.update({
    where: { id: callId },
    data: {
      status: "completed",
      duration: Math.ceil(durationMs / 1000),
      transcript: session.transcript as any,
    },
  }).catch(() => {});

  // Log usage
  const costReal = minutes * 0.08; // ~$0.08/min (voice + tools)
  await prisma.llmUsageLog.create({
    data: {
      userId: session.userId,
      platform: "grok_voice_agent",
      model: "grok-voice-agent",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costReal,
      costCharged: costReal * 10,
      messagesCharged: credits,
    },
  }).catch(() => {});

  // Cleanup Redis
  await redisDel(`voice-agent:${callId}`).catch(() => {});

  activeSessions.delete(callId);
  console.log(`[VOICE-AGENT] [${callId}] Session cleaned up (${minutes} min, ${session.turnCount} turns)`);
}

// ─── Status Callback ─────────────────────────────────

export async function handleVoiceAgentStatus(
  callId: string,
  status: string,
  duration?: string,
): Promise<void> {
  console.log(`[VOICE-AGENT] [${callId}] Status: ${status}${duration ? ` (${duration}s)` : ""}`);

  if (status === "completed" || status === "failed" || status === "busy" || status === "no-answer") {
    await prisma.voiceCall.update({
      where: { id: callId },
      data: {
        status: status === "completed" ? "completed" : "failed",
        duration: duration ? parseInt(duration, 10) : null,
      },
    }).catch(() => {});

    cleanupSession(callId);
  }
}

// ─── Exports ─────────────────────────────────────────

export { VOICE_DESCRIPTIONS, activeSessions };
