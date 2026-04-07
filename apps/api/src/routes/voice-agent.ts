/**
 * Voice Agent Routes — Grok Voice Agent + MCP endpoint
 *
 * POST /api/voice/agent/call           — Initiate voice agent call via Twilio
 * POST /api/voice/agent/twiml/:callId  — TwiML for Twilio (returns <Connect><Stream>)
 * POST /api/voice/agent/status/:callId — Twilio status callback
 * GET  /api/voice/agent/voices         — List available voice options
 * POST /mcp                            — MCP JSON-RPC endpoint for Grok Voice tools
 *
 * WebSocket /api/voice/agent/stream/:callId — handled via server upgrade (see server.ts)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  initiateVoiceAgentCall,
  handleVoiceAgentStatus,
  VOICE_DESCRIPTIONS,
  type GrokVoice,
} from "../services/voice/grok-voice-agent.service.js";
import {
  handleMcpRequest,
  validateMcpAuth,
} from "../services/voice/mcp-server.service.js";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";
const BASE_URL = process.env.PAYJARVIS_PUBLIC_URL || "https://www.payjarvis.com";

export async function voiceAgentRoutes(app: FastifyInstance) {
  // ─── POST /api/voice/agent/call — Initiate voice agent call ───

  app.post("/api/voice/agent/call", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    const apiKey = request.headers["x-bot-api-key"] as string;

    if (secret !== INTERNAL_SECRET && !apiKey) {
      // Try Clerk auth
      try {
        const { requireAuth } = await import("../middleware/auth.js");
        await requireAuth(request, reply);
        if (reply.sent) return;
      } catch {
        return reply.status(401).send({ error: "unauthorized" });
      }
    }

    const body = request.body as {
      userId?: string;
      to: string;
      businessName?: string;
      objective?: string;
      language?: string;
      voice?: GrokVoice;
      callerIdentity?: string;
      userName?: string;
    };

    // userId from auth or body
    const userId = (request as any).userId || body.userId;
    if (!userId || !body.to) {
      return reply.status(400).send({ error: "Missing required fields: userId, to" });
    }

    try {
      const result = await initiateVoiceAgentCall({
        userId,
        to: body.to,
        businessName: body.businessName,
        objective: body.objective,
        language: body.language,
        voice: body.voice,
        callerIdentity: body.callerIdentity,
        userName: body.userName,
      });

      return reply.send({ success: true, ...result });
    } catch (err) {
      const msg = (err as Error).message;
      request.log.error({ err: msg }, "[Voice-Agent] Call initiation failed");
      const status = msg.includes("limit") ? 429 : msg.includes("not found") || msg.includes("not configured") ? 400 : 500;
      return reply.status(status).send({ success: false, error: msg });
    }
  });

  // ─── POST /api/voice/agent/twiml/:callId — TwiML with Stream ───

  app.post("/api/voice/agent/twiml/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const hostname = BASE_URL.replace(/^https?:\/\//, "");

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${hostname}/api/voice/agent/stream/${callId}" />
  </Connect>
</Response>`;

    return reply.header("Content-Type", "text/xml").send(twiml);
  });

  // Also support GET for TwiML
  app.get("/api/voice/agent/twiml/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const hostname = BASE_URL.replace(/^https?:\/\//, "");

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${hostname}/api/voice/agent/stream/${callId}" />
  </Connect>
</Response>`;

    return reply.header("Content-Type", "text/xml").send(twiml);
  });

  // ─── POST /api/voice/agent/status/:callId — Twilio status callback ───

  app.post("/api/voice/agent/status/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const body = request.body as Record<string, string>;

    const status = body?.CallStatus || "";
    const duration = body?.CallDuration || "";

    try {
      await handleVoiceAgentStatus(callId, status, duration || undefined);
    } catch (err) {
      request.log.error({ err: (err as Error).message, callId }, "[Voice-Agent] Status callback error");
    }

    return reply.status(200).send({ status: "ok" });
  });

  // ─── GET /api/voice/agent/voices — List available voices ───

  app.get("/api/voice/agent/voices", async (_request: FastifyRequest, reply: FastifyReply) => {
    const voices = Object.entries(VOICE_DESCRIPTIONS).map(([id, description]) => ({
      id,
      description,
      default: id === "ara",
    }));

    return reply.send({ success: true, voices });
  });

  // ─── POST /mcp — MCP JSON-RPC endpoint ───

  app.post("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    // Auth check
    const authHeader = request.headers.authorization as string | undefined;
    if (!validateMcpAuth(authHeader)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const body = request.body as any;
    if (!body || !body.jsonrpc || !body.method) {
      return reply.status(400).send({ error: "Invalid JSON-RPC request" });
    }

    try {
      const result = await handleMcpRequest(body);
      return reply.send(result);
    } catch (err) {
      request.log.error({ err: (err as Error).message }, "[MCP] Request error");
      return reply.status(500).send({
        jsonrpc: "2.0",
        id: body.id || null,
        error: { code: -32000, message: (err as Error).message },
      });
    }
  });
}
