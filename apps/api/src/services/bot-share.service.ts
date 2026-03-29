import { prisma } from "@payjarvis/database";

// Safe alphabet: no 0, O, I, 1 to avoid confusion
const SAFE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  }
  return code;
}

export interface SharePreview {
  botName: string;
  platform: string;
  skills: string[];
  sharedByName: string;
  useCount: number;
  valid: boolean;
}

export async function generateShareLink(
  botId: string,
  userId: string,
  options?: { expiresInHours?: number; maxUses?: number }
) {
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!user) throw new Error("User not found");

  const bot = await prisma.bot.findFirst({
    where: { id: botId, ownerId: user.id },
    include: { policy: true },
  });
  if (!bot) throw new Error("Bot not found or not owned by user");

  // Build safe templateConfig — NO credentials, NO personal data
  const templateConfig = {
    name: bot.name,
    platform: bot.platform,
    systemPrompt: bot.systemPrompt,
    capabilities: bot.capabilities,
    language: bot.language,
    botDisplayName: bot.botDisplayName,
    policy: bot.policy
      ? {
          maxPerTransaction: bot.policy.maxPerTransaction,
          maxPerDay: bot.policy.maxPerDay,
          autoApproveLimit: bot.policy.autoApproveLimit,
          allowedCategories: bot.policy.allowedCategories,
          timezone: bot.policy.timezone,
        }
      : null,
    sharedByName: user.fullName?.split(" ")[0] ?? "Someone",
  };

  // Generate unique code
  let code = generateCode();
  let attempts = 0;
  while (attempts < 10) {
    const exists = await prisma.botShareLink.findUnique({ where: { code } });
    if (!exists) break;
    code = generateCode();
    attempts++;
  }

  const expiresAt = options?.expiresInHours
    ? new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000)
    : null;

  const shareLink = await prisma.botShareLink.create({
    data: {
      code,
      botId,
      createdByUserId: user.id,
      templateConfig,
      expiresAt,
      maxUses: options?.maxUses ?? null,
    },
  });

  return shareLink;
}

export async function getSharePreview(code: string): Promise<SharePreview | null> {
  const link = await prisma.botShareLink.findUnique({
    where: { code },
  });

  if (!link) return null;

  const config = link.templateConfig as Record<string, unknown>;
  const now = new Date();
  const expired = link.expiresAt ? link.expiresAt < now : false;
  const maxUsesReached = link.maxUses ? link.useCount >= link.maxUses : false;
  const valid = link.active && !expired && !maxUsesReached;

  return {
    botName: (config.name as string) ?? "Bot",
    platform: (config.platform as string) ?? "TELEGRAM",
    skills: (config.capabilities as string[]) ?? [],
    sharedByName: (config.sharedByName as string) ?? "Someone",
    useCount: link.useCount,
    valid,
  };
}

export async function cloneBot(
  code: string,
  userId: string
): Promise<{ bot: Record<string, unknown>; alreadyHasBot: boolean }> {
  const link = await prisma.botShareLink.findUnique({ where: { code } });
  if (!link) throw new Error("Share link not found");

  // Validate
  const now = new Date();
  if (!link.active) throw new Error("Share link is inactive");
  if (link.expiresAt && link.expiresAt < now) throw new Error("Share link has expired");
  if (link.maxUses && link.useCount >= link.maxUses) throw new Error("Share link max uses reached");

  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!user) throw new Error("User not found");

  const config = link.templateConfig as Record<string, unknown>;
  const platform = config.platform as string;

  // Check if user already has a bot on same platform
  const existingBot = await prisma.bot.findFirst({
    where: { ownerId: user.id, platform: platform as any },
  });
  if (existingBot) {
    return { bot: existingBot as unknown as Record<string, unknown>, alreadyHasBot: true };
  }

  // Create new bot from template
  const { createHash, randomBytes } = await import("crypto");
  const rawKey = `pj_bot_${randomBytes(24).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");

  const newBot = await prisma.bot.create({
    data: {
      ownerId: user.id,
      name: (config.name as string) ?? "My Bot",
      platform: platform as any,
      apiKeyHash,
      systemPrompt: (config.systemPrompt as string) ?? null,
      botDisplayName: (config.botDisplayName as string) ?? null,
      capabilities: (config.capabilities as string[]) ?? [],
      language: (config.language as string) ?? "en-US",
    },
  });

  // Create policy from template
  const policyConfig = config.policy as Record<string, unknown> | null;
  await prisma.policy.create({
    data: {
      botId: newBot.id,
      maxPerTransaction: (policyConfig?.maxPerTransaction as number) ?? 100,
      maxPerDay: (policyConfig?.maxPerDay as number) ?? 500,
      autoApproveLimit: (policyConfig?.autoApproveLimit as number) ?? 50,
      allowedCategories: (policyConfig?.allowedCategories as string[]) ?? [],
      timezone: (policyConfig?.timezone as string) ?? "America/New_York",
    },
  });

  // Create agent
  const agentId = `ag_${randomBytes(12).toString("hex")}`;
  await prisma.agent.create({
    data: {
      id: agentId,
      botId: newBot.id,
      ownerId: user.id,
      name: `Agent for ${newBot.name}`,
    },
  });

  // Increment use count
  await prisma.botShareLink.update({
    where: { code },
    data: { useCount: { increment: 1 } },
  });

  // Record clone for referral tracking
  await prisma.botClone.create({
    data: {
      shareCode: code,
      newBotId: newBot.id,
      newUserId: user.id,
      referredByUserId: link.createdByUserId,
    },
  });

  return {
    bot: { ...newBot, apiKey: rawKey } as unknown as Record<string, unknown>,
    alreadyHasBot: false,
  };
}

export async function getUserShareLinks(userId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!user) throw new Error("User not found");

  return prisma.botShareLink.findMany({
    where: { createdByUserId: user.id },
    include: { clones: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBotShareLinks(botId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!user) throw new Error("User not found");

  const bot = await prisma.bot.findFirst({
    where: { id: botId, ownerId: user.id },
  });
  if (!bot) throw new Error("Bot not found or not owned by user");

  return prisma.botShareLink.findMany({
    where: { botId },
    include: { clones: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function deactivateShareLink(code: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!user) throw new Error("User not found");

  const link = await prisma.botShareLink.findUnique({ where: { code } });
  if (!link) throw new Error("Share link not found");
  if (link.createdByUserId !== user.id) throw new Error("Not authorized");

  await prisma.botShareLink.update({
    where: { code },
    data: { active: false },
  });
}
