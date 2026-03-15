/**
 * Sequence Service — 8-step onboarding drip banners over 60 days.
 * Pauses if user inactive > 2 days. Resumes when they come back.
 */

import { prisma } from "@payjarvis/database";

// ─── Config ──────────────────────────────────────────────

interface StepConfig {
  step: number;
  day: number;
  banner: string;
  en: string;
  pt: string;
}

const STEPS: StepConfig[] = [
  { step: 0, day: 0, banner: "jarvis_welcome.png", en: "", pt: "" },
  { step: 1, day: 3, banner: "jarvis_health.png",
    en: "🔓 New capability unlocked.\n\nJarvis can now support your health journey.\n\nNutrition plans, workout routines, personal metrics — all from this conversation.\n\nWant to set up your wellness profile?",
    pt: "🔓 Nova capacidade desbloqueada.\n\nO Jarvis agora pode cuidar da sua saúde.\n\nPlano alimentar, rotina de exercícios, métricas pessoais — tudo nessa conversa.\n\nQuer configurar seu perfil de bem-estar?" },
  { step: 2, day: 7, banner: "jarvis_learning.png",
    en: "🔓 Unlocked: Personal Tutor.\n\nAny subject. Your pace. Your goals.\n\nEntrepreneurship, finance, languages, technology — what do you want to learn?",
    pt: "🔓 Desbloqueado: Tutor Pessoal.\n\nQualquer assunto. Seu ritmo. Seus objetivos.\n\nEmpreendedorismo, finanças, idiomas, tecnologia — o que você quer aprender?" },
  { step: 3, day: 14, banner: "jarvis_news.png",
    en: "🔓 Daily Briefing activated.\n\nEvery morning I can send you the top headlines from the areas you care about.\n\nNo noise. Just what matters.\n\nWhich topics should I monitor?\n\n1. Technology & AI\n2. Business & Finance\n3. Your industry (tell me which)\n4. All of the above",
    pt: "🔓 Briefing Diário ativado.\n\nTodos os dias posso te enviar as principais manchetes das áreas que você se interessa.\n\nSem ruído. Só o que importa.\n\nQuais tópicos devo monitorar?\n\n1. Tecnologia e IA\n2. Negócios e Finanças\n3. Seu setor (me diz qual)\n4. Todos" },
  { step: 4, day: 21, banner: "jarvis_documents.png",
    en: "🔓 Document assistant active.\n\nContracts, emails, proposals, summaries — handled.\n\nNeed help with something right now?",
    pt: "🔓 Assistente de documentos ativo.\n\nContratos, e-mails, propostas, resumos — resolvidos.\n\nPrecisa de ajuda com algo agora?" },
  { step: 5, day: 30, banner: "jarvis_finance.png",
    en: "🔓 Financial intelligence on.\n\nI've been tracking your spending patterns.\n\nWant your first monthly report?",
    pt: "🔓 Inteligência financeira ativa.\n\nEstou acompanhando seus padrões de gasto.\n\nQuer seu primeiro relatório mensal?" },
  { step: 6, day: 45, banner: "jarvis_travel.png",
    en: "🔓 Full travel planning unlocked.\n\nFlights, hotels, restaurants, complete itinerary — one conversation.\n\nPlanning a trip?",
    pt: "🔓 Planejamento de viagens completo desbloqueado.\n\nVoos, hotéis, restaurantes, roteiro completo — uma conversa.\n\nEstá planejando uma viagem?" },
  { step: 7, day: 60, banner: "jarvis_intelligence.png",
    en: "🔓 Final upgrade complete.\n\nWeekly market intelligence for your sector.\n\nIndustry news, opportunities, trends — delivered every Monday.\n\nWhat industry should I monitor?",
    pt: "🔓 Upgrade final completo.\n\nInteligência de mercado semanal para o seu setor.\n\nNotícias, oportunidades, tendências — toda segunda-feira.\n\nQual setor devo monitorar?" },
];

// Welcome sequence messages for step 0
const WELCOME_EN = [
  { delay: 1000, text: "Hello. I'm Jarvis.\n\nYour personal executive assistant.\n\nShopping, travel, health, learning, documents, finance — I handle it all so you can focus on what matters.\n\nWhere would you like to start?" },
  { delay: 30000, text: "Before we begin, let me tell you who built me.\n\n12Brain is an AI startup based in Miami, Florida — specialized in artificial intelligence and autonomous agents.\n\nTheir mission: democratize technology. Make what was once exclusive, accessible to everyone.\n\nThat's why I arrived in your hands through a simple conversation.\n\nWhat you have here is among the most advanced autonomous agents available today — and 12Brain is committed to keeping me updated so I can always deliver my best to you.\n\nTogether, we move toward the technological future ahead of us." },
];

const WELCOME_PT = [
  { delay: 1000, text: "Olá. Eu sou o Jarvis.\n\nSeu secretário executivo pessoal.\n\nCompras, viagens, saúde, aprendizado, documentos, finanças — cuido de tudo para que você foque no que importa.\n\nPor onde quer começar?" },
  { delay: 30000, text: "Antes de começarmos, deixa eu te contar quem me criou.\n\nA 12Brain é uma startup de IA sediada em Miami, na Flórida — especializada em inteligência artificial e agentes autônomos.\n\nMissão deles: democratizar a tecnologia. Tornar acessível o que antes era exclusivo.\n\nPor isso cheguei até você de uma maneira tão simples.\n\nO que você tem nas mãos está entre os agentes autônomos mais avançados disponíveis hoje — e a 12Brain se compromete a me manter atualizado para que eu sempre possa dar o melhor para você.\n\nJuntos, caminhamos em direção ao futuro tecnológico que nos espera." },
];

const BANNER_BASE_URL = process.env.BANNER_BASE_URL || "https://www.payjarvis.com/public/banners";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

const INACTIVE_THRESHOLD_MS = 2 * 86400000;

function detectLang(chatId: string): "en" | "pt" {
  return chatId.includes("+55") ? "pt" : "en";
}

// ─── Sending helpers ─────────────────────────────────────

async function sendPhoto(platform: string, chatId: string, url: string): Promise<void> {
  try {
    if (platform === "telegram" && TELEGRAM_BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, photo: url }),
      });
    } else if (platform === "whatsapp" && TWILIO_ACCOUNT_SID) {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: TWILIO_WHATSAPP_NUMBER, To: chatId, MediaUrl: url }).toString(),
      });
    }
  } catch (err) {
    console.error("[Sequence] sendPhoto error:", (err as Error).message);
  }
}

async function sendText(platform: string, chatId: string, text: string): Promise<void> {
  try {
    if (platform === "telegram" && TELEGRAM_BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      });
    } else if (platform === "whatsapp" && TWILIO_ACCOUNT_SID) {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: TWILIO_WHATSAPP_NUMBER, To: chatId, Body: text }).toString(),
      });
    }
  } catch (err) {
    console.error("[Sequence] sendText error:", (err as Error).message);
  }
}

// ─── Public API ──────────────────────────────────────────

export async function initSequence(
  userId: string,
  platform: string,
  chatId: string,
  referredByName?: string,
): Promise<void> {
  const existing = await prisma.onboardingSequence.findUnique({ where: { userId } });
  if (existing) return;

  const now = new Date();
  const nextSendAt = new Date(now.getTime() + STEPS[1].day * 86400000);

  await prisma.onboardingSequence.create({
    data: {
      userId, platform, chatId,
      joinedAt: now, lastActiveAt: now,
      currentStep: 0, nextSendAt,
      stepsCompleted: [0], active: true,
    },
  });

  console.log(`[Sequence] Init for ${userId} on ${platform}`);

  const lang = detectLang(chatId);
  const hasReferral = !!referredByName;

  // 1. Banner
  await sendPhoto(platform, chatId, `${BANNER_BASE_URL}/jarvis_welcome.png`);

  // 2. Welcome messages with delays
  const msgs = lang === "pt" ? WELCOME_PT : WELCOME_EN;
  for (const msg of msgs) {
    await new Promise((r) => setTimeout(r, msg.delay));
    await sendText(platform, chatId, msg.text);
  }

  // 3. Pricing + name question
  await new Promise((r) => setTimeout(r, 8000));

  let pricingMsg: string;
  if (hasReferral && lang === "pt") {
    pricingMsg = `Ter um secretário executivo pessoal disponível 24 horas por dia, todos os dias do ano — cuidando das suas compras, viagens, saúde, aprendizado e organização — normalmente custaria muito mais.\n\nO Jarvis faz tudo isso por $20/mês.\n\nMas como ${referredByName} te indicou, você não vai pagar nada pelos próximos 60 dias.\n\nSem cartão. Sem compromisso. É só usar.\n\nApós 60 dias, se quiser manter seu assistente, são $20/mês. Se não — sem cobranças, sem perguntas.\n\nVocê tem 5.000 mensagens gratuitas para começar.\n\nQual é o seu nome?`;
  } else if (hasReferral) {
    pricingMsg = `Having a personal executive assistant available 24 hours a day, every day of the year — handling your shopping, travel, health, learning and daily organization — would normally cost thousands per month.\n\nJarvis does all of that for $20/month.\n\nBut because ${referredByName} invited you, you won't pay anything for the next 60 days.\n\nNo credit card. No commitment. Just use it.\n\nAfter 60 days, if you want to keep your assistant, it's $20/month. If not — no charges, no questions.\n\nYou have 5,000 free messages to start.\n\nWhat's your name?`;
  } else if (lang === "pt") {
    pricingMsg = "Você tem 5.000 mensagens gratuitas para explorar tudo que o Jarvis pode fazer.\n\nQual é o seu nome?";
  } else {
    pricingMsg = "You have 5,000 free messages to explore everything Jarvis can do.\n\nWhat's your name?";
  }

  await sendText(platform, chatId, pricingMsg);
  console.log(`[Sequence] Step 0 complete for ${userId}`);
}

export async function markActive(userId: string): Promise<void> {
  const seq = await prisma.onboardingSequence.findUnique({ where: { userId } });
  if (!seq || !seq.active) return;

  const wasPaused = seq.nextSendAt === null;
  await prisma.onboardingSequence.update({ where: { userId }, data: { lastActiveAt: new Date() } });

  if (wasPaused) {
    await resumeSequence(userId);
  }
}

export async function resumeSequence(userId: string): Promise<void> {
  const seq = await prisma.onboardingSequence.findUnique({ where: { userId } });
  if (!seq || !seq.active) return;

  const nextStep = seq.currentStep + 1;
  if (nextStep >= STEPS.length) return;

  const nextSendAt = new Date(Date.now() + 86400000); // 24h
  await prisma.onboardingSequence.update({ where: { userId }, data: { nextSendAt } });
  console.log(`[Sequence] Resumed ${userId}, next at ${nextSendAt.toISOString()}`);
}

export async function processPendingSequences(): Promise<void> {
  const now = new Date();
  const pending = await prisma.onboardingSequence.findMany({
    where: { active: true, nextSendAt: { lte: now } },
  });

  if (!pending.length) return;
  console.log(`[Sequence] Processing ${pending.length} pending`);

  for (const seq of pending) {
    try {
      const timeSinceActive = now.getTime() - seq.lastActiveAt.getTime();
      if (timeSinceActive > INACTIVE_THRESHOLD_MS) {
        await prisma.onboardingSequence.update({ where: { id: seq.id }, data: { nextSendAt: null } });
        console.log(`[Sequence] Paused ${seq.userId} — inactive ${Math.floor(timeSinceActive / 86400000)}d`);
        continue;
      }

      const daysSinceJoin = Math.floor((now.getTime() - seq.joinedAt.getTime()) / 86400000);
      let stepToSend: StepConfig | null = null;

      for (const step of STEPS) {
        if (step.step > seq.currentStep && daysSinceJoin >= step.day && !seq.stepsCompleted.includes(step.step)) {
          stepToSend = step;
          break;
        }
      }

      if (!stepToSend) {
        await prisma.onboardingSequence.update({ where: { id: seq.id }, data: { active: false, nextSendAt: null } });
        console.log(`[Sequence] Completed ${seq.userId}`);
        continue;
      }

      // Send banner
      await sendPhoto(seq.platform, seq.chatId, `${BANNER_BASE_URL}/${stepToSend.banner}`);

      // Send text
      const lang = detectLang(seq.chatId);
      const text = lang === "pt" ? stepToSend.pt : stepToSend.en;
      if (text) {
        await new Promise((r) => setTimeout(r, 1000));
        await sendText(seq.platform, seq.chatId, text);
      }

      // Update
      const newCompleted = [...seq.stepsCompleted, stepToSend.step];
      const nextIdx = stepToSend.step + 1;
      const nextSendAt = nextIdx < STEPS.length
        ? new Date(seq.joinedAt.getTime() + STEPS[nextIdx].day * 86400000)
        : null;
      // If next date is in the past, send in 1h
      const finalNextSend = nextSendAt && nextSendAt.getTime() < Date.now()
        ? new Date(Date.now() + 3600000)
        : nextSendAt;

      await prisma.onboardingSequence.update({
        where: { id: seq.id },
        data: {
          currentStep: stepToSend.step,
          stepsCompleted: newCompleted,
          nextSendAt: finalNextSend,
          active: finalNextSend !== null,
        },
      });

      console.log(`[Sequence] Sent step ${stepToSend.step} to ${seq.userId}`);
    } catch (err) {
      console.error(`[Sequence] Error ${seq.userId}:`, (err as Error).message);
    }
  }
}

export async function getSequenceStatus(userId: string) {
  const seq = await prisma.onboardingSequence.findUnique({ where: { userId } });
  if (!seq) return null;
  return {
    currentStep: seq.currentStep,
    totalSteps: STEPS.length,
    stepsCompleted: seq.stepsCompleted,
    nextSendAt: seq.nextSendAt,
    active: seq.active,
    isPaused: seq.active && seq.nextSendAt === null,
    joinedAt: seq.joinedAt,
    lastActiveAt: seq.lastActiveAt,
  };
}

export const sequenceService = {
  initSequence,
  markActive,
  resumeSequence,
  processPendingSequences,
  getSequenceStatus,
};
