// ─── Call Recordings — Webhook + Admin + User routes ────────────────────
import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import twilio from "twilio";
const { validateRequest } = twilio;

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const BASE_URL = process.env.PAYJARVIS_PUBLIC_URL || process.env.PUBLIC_URL || "https://www.payjarvis.com";

export async function recordingRoutes(app: FastifyInstance) {
  // Parse form-urlencoded for Twilio webhooks
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 1048576 },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        const parsed: Record<string, string> = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // ─── Twilio Recording Webhook ─────────────────────────────
  // POST /api/webhooks/twilio-recording
  // Twilio calls this when a recording is completed
  app.post("/api/webhooks/twilio-recording", async (request, reply) => {
    const body = request.body as Record<string, string>;

    // Validate Twilio signature
    const signature = request.headers["x-twilio-signature"] as string;
    const url = `${BASE_URL}/api/webhooks/twilio-recording`;
    if (TWILIO_AUTH_TOKEN && signature) {
      if (!validateRequest(TWILIO_AUTH_TOKEN, signature, url, body || {})) {
        request.log.warn("[RECORDING] Invalid Twilio signature");
        return reply.status(403).send("Forbidden");
      }
    }

    const {
      RecordingSid: recordingSid,
      RecordingUrl: recordingUrl,
      RecordingDuration: durationStr,
      CallSid: callSid,
      AccountSid: _accountSid,
    } = body;

    if (!recordingSid || !callSid) {
      return reply.status(400).send({ error: "Missing RecordingSid or CallSid" });
    }

    const duration = parseInt(durationStr || "0", 10);

    // Find the voice call to get userId, from, to
    let userId = "unknown";
    let fromNumber = "";
    let toNumber = "";
    let direction = "outbound";

    try {
      const voiceCall = await prisma.$queryRaw<Array<{
        user_id: string;
        from: string;
        to: string;
      }>>`
        SELECT user_id, "from", "to" FROM voice_calls WHERE call_sid = ${callSid} LIMIT 1
      `;

      if (voiceCall.length > 0) {
        userId = voiceCall[0].user_id;
        fromNumber = voiceCall[0].from;
        toNumber = voiceCall[0].to;
      }

      // Also update the voice_calls table with recordingUrl
      await prisma.$executeRaw`
        UPDATE voice_calls SET "recordingUrl" = ${recordingUrl + ".mp3"}, updated_at = now()
        WHERE call_sid = ${callSid}
      `;
    } catch (err) {
      request.log.error(`[RECORDING] Failed to lookup call ${callSid}: ${(err as Error).message}`);
    }

    // Save recording to call_recordings table
    try {
      await prisma.$executeRaw`
        INSERT INTO call_recordings (id, "userId", "callSid", "recordingSid", "recordingUrl", "durationSeconds", "fromNumber", "toNumber", direction, "createdAt")
        VALUES (${`rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`}, ${userId}, ${callSid}, ${recordingSid}, ${recordingUrl + ".mp3"}, ${duration}, ${fromNumber}, ${toNumber}, ${direction}, now())
        ON CONFLICT ("recordingSid") DO NOTHING
      `;

      console.log(`[RECORDING] Call ${callSid} recorded: ${recordingSid} (${duration}s) ${fromNumber} → ${toNumber}`);
    } catch (err) {
      request.log.error(`[RECORDING] Failed to save recording: ${(err as Error).message}`);
    }

    return reply.status(204).send();
  });

  // ─── Admin: List All Recordings ───────────────────────────
  // GET /admin/recordings
  app.get("/admin/recordings", async (request, reply) => {
    // Admin auth check
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7);
    try {
      const { verifyToken } = await import("../services/admin-auth.service.js");
      await verifyToken(token);
    } catch {
      return reply.status(401).send({ error: "Invalid admin token" });
    }

    const { limit: limitStr, offset: offsetStr } = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(limitStr || "50", 10), 100);
    const offset = parseInt(offsetStr || "0", 10);

    const recordings = await prisma.$queryRaw<Array<{
      id: string;
      userId: string;
      callSid: string;
      recordingSid: string;
      recordingUrl: string;
      durationSeconds: number;
      fromNumber: string;
      toNumber: string;
      direction: string;
      createdAt: Date;
    }>>`
      SELECT r.*, u.email as user_email, u."fullName" as user_name
      FROM call_recordings r
      LEFT JOIN users u ON r."userId" = u.id
      ORDER BY r."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM call_recordings
    `;

    return {
      success: true,
      data: recordings,
      total: Number(total[0].count),
      limit,
      offset,
    };
  });

  // ─── User: List My Recordings ─────────────────────────────
  // GET /api/voice/recordings (used by Gemini tool list_call_recordings)
  app.get("/api/voice/recordings", async (request, reply) => {
    const internalSecret = request.headers["x-internal-secret"] as string;
    const userId = request.headers["x-user-id"] as string;

    if (internalSecret !== process.env.INTERNAL_SECRET) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!userId) {
      return reply.status(400).send({ error: "x-user-id header required" });
    }

    // Resolve user by telegramChatId or phone
    const user = await prisma.user.findFirst({
      where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }, { id: userId }] },
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const { limit: limitStr } = request.query as { limit?: string };
    const limit = Math.min(parseInt(limitStr || "10", 10), 50);

    const recordings = await prisma.$queryRaw<Array<{
      id: string;
      callSid: string;
      recordingUrl: string;
      durationSeconds: number;
      fromNumber: string;
      toNumber: string;
      direction: string;
      createdAt: Date;
    }>>`
      SELECT id, "callSid", "recordingUrl", "durationSeconds", "fromNumber", "toNumber", direction, "createdAt"
      FROM call_recordings
      WHERE "userId" = ${user.id}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;

    return { success: true, recordings };
  });
}
