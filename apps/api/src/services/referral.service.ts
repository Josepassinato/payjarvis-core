import { prisma } from "@payjarvis/database";

export interface ReferralStats {
  totalClones: number;
  totalConversions: number;
  shareLinks: Array<{
    code: string;
    botName: string;
    useCount: number;
    active: boolean;
    createdAt: Date;
  }>;
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!user) throw new Error("User not found");

  const shareLinks = await prisma.botShareLink.findMany({
    where: { createdByUserId: user.id },
    include: {
      bot: { select: { name: true } },
      clones: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const totalClones = shareLinks.reduce((sum, link) => sum + link.useCount, 0);

  // Count conversions: clones where the new user completed onboarding
  const allClones = shareLinks.flatMap((l) => l.clones);
  const newUserIds = [...new Set(allClones.map((c) => c.newUserId))];

  let totalConversions = 0;
  if (newUserIds.length > 0) {
    const completedUsers = await prisma.user.count({
      where: {
        id: { in: newUserIds },
        onboardingCompleted: true,
      },
    });
    totalConversions = completedUsers;
  }

  return {
    totalClones,
    totalConversions,
    shareLinks: shareLinks.map((link) => ({
      code: link.code,
      botName: link.bot.name,
      useCount: link.useCount,
      active: link.active,
      createdAt: link.createdAt,
    })),
  };
}

export async function notifyReferrer(
  referredByUserId: string,
  newUserName: string
) {
  // Find referrer's notification channel
  const referrer = await prisma.user.findUnique({
    where: { id: referredByUserId },
  });

  if (!referrer) return;

  const firstName = newUserName.split(" ")[0];
  const message = `${firstName} ativou o bot que você compartilhou! Obrigado por espalhar a palavra.`;

  // Log for now — actual notification integration (Telegram/WhatsApp)
  // can be wired up via the existing notification service
  console.log(
    `[REFERRAL] Notify ${referrer.email}: ${message}`
  );
}
