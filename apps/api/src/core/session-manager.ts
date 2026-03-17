import { randomUUID } from "node:crypto";
import { redisSet, redisGet, redisDel } from "../services/redis.js";

// ─── Types ───

export interface BotSession {
  sessionId: string;
  botId: string;
  userId: string;
  startedAt: string;
  lastActivityAt: string;
  currentIntent: string | null;
  pendingActions: PendingAction[];
  context: Record<string, unknown>;
}

export interface PendingAction {
  type: string;
  params: Record<string, unknown>;
  createdAt: string;
}

const SESSION_TTL = 30 * 60; // 30 minutes in seconds

function sessionKey(botId: string, userId?: string): string {
  if (userId) return `session:bot:${botId}:user:${userId}`;
  return `session:bot:${botId}`;
}

/**
 * Create a new session for a bot, replacing any existing one.
 */
export async function createSession(botId: string, userId: string): Promise<string> {
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const session: BotSession = {
    sessionId,
    botId,
    userId,
    startedAt: now,
    lastActivityAt: now,
    currentIntent: null,
    pendingActions: [],
    context: {},
  };

  await redisSet(sessionKey(botId, userId), JSON.stringify(session), SESSION_TTL);
  return sessionId;
}

/**
 * Get the current session for a bot, or null if none/expired.
 */
export async function getSession(botId: string, userId?: string): Promise<BotSession | null> {
  const raw = await redisGet(sessionKey(botId, userId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as BotSession;
  } catch {
    return null;
  }
}

/**
 * Update fields on an existing session. Refreshes TTL and lastActivityAt.
 */
export async function updateSession(
  botId: string,
  updates: Partial<Pick<BotSession, "currentIntent" | "pendingActions" | "context">>,
  userId?: string
): Promise<BotSession | null> {
  const session = await getSession(botId, userId);
  if (!session) return null;

  const updated: BotSession = {
    ...session,
    ...updates,
    lastActivityAt: new Date().toISOString(),
  };

  await redisSet(sessionKey(botId, userId ?? session.userId), JSON.stringify(updated), SESSION_TTL);
  return updated;
}

/**
 * End (delete) a bot's session.
 */
export async function endSession(botId: string, userId?: string): Promise<void> {
  await redisDel(sessionKey(botId, userId));
}
