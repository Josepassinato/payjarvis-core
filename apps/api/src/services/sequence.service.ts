/**
 * Sequence Service — 8-step onboarding drip banners (Beta phase).
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
  es: string;
}

const STEPS: StepConfig[] = [
  { step: 0, day: 0, banner: "banner_day0_welcome.png",
    en: "Your personal assistant is ready!\n\nShopping, Travel, Health, Learning — all in one conversation.\n\nSend 'Hi' to get started!",
    pt: "Seu assistente pessoal está pronto!\n\nShopping, Viagem, Saúde, Aprendizado — tudo em uma conversa.\n\nManda um 'Oi' pra começar!",
    es: "¡Tu asistente personal está listo!\n\nCompras, Viajes, Salud, Aprendizaje — todo en una conversación.\n\n¡Envía 'Hola' para empezar!" },
  { step: 1, day: 3, banner: "banner_day3_voice.png",
    en: "Did you know you can talk to Jarvis by voice?\n\nSend an audio message and get a voice response — like talking to a friend.\n\nTry it now: record an audio!",
    pt: "Sabia que você pode falar com o Jarvis por áudio?\n\nMande um áudio e receba a resposta em voz — como falar com um amigo.\n\nTesta agora: grave um áudio!",
    es: "¿Sabías que puedes hablar con Jarvis por voz?\n\nEnvía un audio y recibe respuesta en voz — como hablar con un amigo.\n\n¡Pruébalo ahora: graba un audio!" },
  { step: 2, day: 5, banner: "banner_day5_shopping.png",
    en: "Smart Shopping unlocked!\n\nI search products, compare prices, and find the best deals for you.\n\nTry: 'Find me an iPhone 15'",
    pt: "Compras Inteligentes desbloqueadas!\n\nBusco produtos, comparo preços e encontro as melhores ofertas pra você.\n\nTesta: 'Procura um iPhone 15 pra mim'",
    es: "¡Compras Inteligentes desbloqueadas!\n\nBusco productos, comparo precios y encuentro las mejores ofertas.\n\nPrueba: 'Búscame un iPhone 15'" },
  { step: 3, day: 8, banner: "banner_day8_location.png",
    en: "Share your location and unlock nearby results!\n\nRestaurants, hotels, events — all near you with real ratings and Google Maps links.\n\nSend your location now!",
    pt: "Compartilhe sua localização e desbloqueie resultados perto de você!\n\nRestaurantes, hotéis, eventos — tudo perto com avaliações reais e links do Google Maps.\n\nEnvia sua localização agora!",
    es: "¡Comparte tu ubicación y desbloquea resultados cercanos!\n\nRestaurantes, hoteles, eventos — todo cerca de ti con calificaciones reales y enlaces de Google Maps.\n\n¡Envía tu ubicación ahora!" },
  { step: 4, day: 10, banner: "banner_pwa_install.png",
    en: "Install Jarvis on your phone!\n\nOpen payjarvis.com/chat in your browser and add it to your Home Screen. One tap and I'm always here — like a real app!\n\niPhone: Safari → Share → Add to Home Screen\nAndroid: Chrome → Menu ⋮ → Add to Home Screen",
    pt: "Instale o Jarvis no seu celular!\n\nAbra payjarvis.com/chat no navegador e adicione à Tela Inicial. Um toque e eu estou sempre aqui — como um app de verdade!\n\niPhone: Safari → Compartilhar → Adicionar à Tela de Início\nAndroid: Chrome → Menu ⋮ → Adicionar à tela inicial",
    es: "¡Instala Jarvis en tu celular!\n\nAbre payjarvis.com/chat en tu navegador y agrégalo a la Pantalla de Inicio. ¡Un toque y siempre estoy aquí — como una app real!\n\niPhone: Safari → Compartir → Agregar a Inicio\nAndroid: Chrome → Menú ⋮ → Agregar a Inicio" },
  { step: 5, day: 11, banner: "banner_day11_restaurants.png",
    en: "Your dining guide is ready!\n\nReal restaurants with ratings, phone numbers, reservations, and Google Maps links.\n\nTry: 'Japanese restaurant near me'",
    pt: "Seu guia gastronômico está pronto!\n\nRestaurantes reais com avaliações, telefone, reserva e link do Google Maps.\n\nTesta: 'Restaurante japonês perto de mim'",
    es: "¡Tu guía gastronómica está lista!\n\nRestaurantes reales con calificaciones, teléfono, reservas y enlaces de Google Maps.\n\nPrueba: 'Restaurante japonés cerca de mí'" },
  { step: 6, day: 14, banner: "banner_day14_travel.png",
    en: "Full travel planning unlocked!\n\nComplete day-by-day itineraries, flights, hotels, and local tips for any destination.\n\nTry: 'Plan a 5-day trip to Lisbon'",
    pt: "Planejamento de viagem completo!\n\nRoteiros dia-a-dia, voos, hotéis e dicas locais para qualquer destino.\n\nTesta: 'Faz um roteiro de 5 dias em Lisboa'",
    es: "¡Planificación de viajes completa!\n\nItinerarios día a día, vuelos, hoteles y tips locales para cualquier destino.\n\nPrueba: 'Planifica un viaje de 5 días a Lisboa'" },
  { step: 7, day: 18, banner: "banner_day18_documents.png",
    en: "Document assistant activated!\n\nContracts, reports, letters — generated as PDF and sent directly to you.\n\nTry: 'Write a service contract'",
    pt: "Assistente de documentos ativo!\n\nContratos, relatórios, cartas — gerados em PDF e enviados direto pra você.\n\nTesta: 'Escreve um contrato de serviços'",
    es: "¡Asistente de documentos activado!\n\nContratos, reportes, cartas — generados en PDF y enviados directamente.\n\nPrueba: 'Escribe un contrato de servicios'" },
  { step: 8, day: 21, banner: "banner_day21_fullpower.png",
    en: "You have a complete concierge!\n\n12 areas of expertise: Shopping, Travel, Health, Finance, Education, and more.\n\nJarvis is ready for anything. What do you need today?",
    pt: "Você tem um concierge completo!\n\n12 áreas: Shopping, Viagem, Saúde, Finanças, Educação e muito mais.\n\nO Jarvis está pronto pra tudo. O que você precisa hoje?",
    es: "¡Tienes un concierge completo!\n\n12 áreas: Compras, Viajes, Salud, Finanzas, Educación y mucho más.\n\nJarvis está listo para todo. ¿Qué necesitas hoy?" },
];

// Welcome sequence messages for step 0
const WELCOME_EN = [
  { delay: 1000, text: "Hi! I'm Jarvis — your personal shopping assistant.\n\n🔒 Your data is protected with Zero-Knowledge encryption. Not even we can see it.\n\nAsk me anything. I'm here 24/7!" },
];

const WELCOME_PT = [
  { delay: 1000, text: "Oi! Eu sou o Jarvis — seu assistente pessoal de compras.\n\n🔒 Seus dados são protegidos com criptografia Zero-Knowledge. Nem nós conseguimos ver.\n\nMe pergunta qualquer coisa. Estou aqui 24/7!" },
];

const WELCOME_ES = [
  { delay: 1000, text: "¡Hola! Soy Jarvis — tu asistente personal de compras.\n\n🔒 Tus datos están protegidos con cifrado Zero-Knowledge. Ni nosotros podemos verlos.\n\n¡Pregúntame lo que sea. Estoy aquí 24/7!" },
];

const BANNER_BASE_URL = process.env.BANNER_BASE_URL || "https://www.payjarvis.com/public/banners";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+17547145921";

const INACTIVE_THRESHOLD_MS = 2 * 86400000;

type SeqLang = "en" | "pt" | "es";

async function detectLang(chatId: string): Promise<SeqLang> {
  // 1. Check user fact saved during onboarding
  try {
    const rows = await prisma.$queryRaw<{ fact_value: string }[]>`
      SELECT fact_value FROM openclaw_user_facts
      WHERE user_id = ${chatId} AND fact_key = 'language' LIMIT 1
    `;
    if (rows.length > 0) {
      const val = rows[0].fact_value;
      if (val.startsWith("pt")) return "pt";
      if (val.startsWith("es")) return "es";
      if (val.startsWith("en")) return "en";
    }
  } catch {
    // table may not exist for all users
  }

  // 2. Fallback to phone prefix
  if (chatId.includes("+55")) return "pt";
  if (["+34", "+52", "+54", "+56", "+57"].some((p) => chatId.includes(p))) return "es";
  return "en";
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

  const lang = await detectLang(chatId);
  const hasReferral = !!referredByName;

  // 1. Logo + Banner
  await sendPhoto(platform, chatId, `${BANNER_BASE_URL}/../logo-full.png`);
  await sendPhoto(platform, chatId, `${BANNER_BASE_URL}/jarvis_welcome.png`);

  // 2. Welcome messages with delays
  const msgs = lang === "pt" ? WELCOME_PT : lang === "es" ? WELCOME_ES : WELCOME_EN;
  for (const msg of msgs) {
    await new Promise((r) => setTimeout(r, msg.delay));
    await sendText(platform, chatId, msg.text);
  }

  // 3. Pricing + name question
  await new Promise((r) => setTimeout(r, 8000));

  let pricingMsg: string;
  if (hasReferral) {
    pricingMsg = `${referredByName} invited you — you're in Beta, enjoy full access for free!\n\nWhat's your name?`;
  } else {
    pricingMsg = "You're in Beta — enjoy full access for free!\n\nWhat's your name?";
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
      const lang = await detectLang(seq.chatId);
      const text = lang === "pt" ? stepToSend.pt : lang === "es" ? stepToSend.es : stepToSend.en;
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
