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
  bannerPt?: string;
  en: string;
  pt: string;
  es: string;
}

const STEPS: StepConfig[] = [
  { step: 0, day: 0, banner: "banner_day0_welcome.png",
    en: "Your shopping agent is ready! 🐕\n\nI find the best price, compare stores, and monitor deals for you.\n\nSend a product name to get started!",
    pt: "Seu agente de compras está pronto! 🐕\n\nAcho o melhor preço, comparo lojas e monitoro ofertas pra você.\n\nManda o nome de um produto pra começar!",
    es: "Tu agente de compras esta listo! 🐕\n\nEncuentro el mejor precio, comparo tiendas y monitoreo ofertas.\n\nEnvia el nombre de un producto para empezar!" },
  { step: 1, day: 3, banner: "banner_day3_voice.png",
    en: "Did you know you can talk to Sniffer by voice? 🐕\n\nSend an audio message and get a voice response — like talking to a friend.\n\nTry it now: record an audio!",
    pt: "Sabia que você pode falar com o Sniffer por áudio? 🐕\n\nMande um áudio e receba a resposta em voz — como falar com um amigo.\n\nTesta agora: grave um áudio!",
    es: "¿Sabías que puedes hablar con Sniffer por voz? 🐕\n\nEnvía un audio y recibe respuesta en voz — como hablar con un amigo.\n\n¡Pruébalo ahora: graba un audio!" },
  { step: 2, day: 5, banner: "banner_day5_shopping.png",
    en: "Smart Shopping unlocked!\n\nI search products, compare prices, and find the best deals for you.\n\nTry: 'Find me an iPhone 15'",
    pt: "Compras Inteligentes desbloqueadas!\n\nBusco produtos, comparo preços e encontro as melhores ofertas pra você.\n\nTesta: 'Procura um iPhone 15 pra mim'",
    es: "¡Compras Inteligentes desbloqueadas!\n\nBusco productos, comparo precios y encuentro las mejores ofertas.\n\nPrueba: 'Búscame un iPhone 15'" },
  { step: 3, day: 8, banner: "banner_day8_location.png",
    en: "Share your location and unlock nearby results!\n\nRestaurants, hotels, events — all near you with real ratings and Google Maps links.\n\nSend your location now!",
    pt: "Compartilhe sua localização e desbloqueie resultados perto de você!\n\nRestaurantes, hotéis, eventos — tudo perto com avaliações reais e links do Google Maps.\n\nEnvia sua localização agora!",
    es: "¡Comparte tu ubicación y desbloquea resultados cercanos!\n\nRestaurantes, hoteles, eventos — todo cerca de ti con calificaciones reales y enlaces de Google Maps.\n\n¡Envía tu ubicación ahora!" },
  { step: 4, day: 10, banner: "banner_pwa_install.png", bannerPt: "banner_pwa_install_pt.png",
    en: "Install Sniffer on your phone! 🐕\n\nOpen payjarvis.com/chat in your browser and add it to your Home Screen. One tap and I'm always here — like a real app!\n\niPhone: Safari → Share → Add to Home Screen\nAndroid: Chrome → Menu ⋮ → Add to Home Screen",
    pt: "Instale o Sniffer no seu celular! 🐕\n\nAbra payjarvis.com/chat no navegador e adicione à Tela Inicial. Um toque e eu estou sempre aqui — como um app de verdade!\n\niPhone: Safari → Compartilhar → Adicionar à Tela de Início\nAndroid: Chrome → Menu ⋮ → Adicionar à tela inicial",
    es: "¡Instala Sniffer en tu celular! 🐕\n\nAbre payjarvis.com/chat en tu navegador y agrégalo a la Pantalla de Inicio. ¡Un toque y siempre estoy aquí — como una app real!\n\niPhone: Safari → Compartir → Agregar a Inicio\nAndroid: Chrome → Menú ⋮ → Agregar a Inicio" },
  { step: 5, day: 11, banner: "banner_day11_restaurants.png",
    en: "Your dining guide is ready!\n\nReal restaurants with ratings, phone numbers, reservations, and Google Maps links.\n\nTry: 'Japanese restaurant near me'",
    pt: "Seu guia gastronômico está pronto!\n\nRestaurantes reais com avaliações, telefone, reserva e link do Google Maps.\n\nTesta: 'Restaurante japonês perto de mim'",
    es: "¡Tu guía gastronómica está lista!\n\nRestaurantes reales con calificaciones, teléfono, reservas y enlaces de Google Maps.\n\nPrueba: 'Restaurante japonés cerca de mí'" },
  { step: 6, day: 14, banner: "banner_day14_travel.png",
    en: "Full travel planning unlocked!\n\nComplete day-by-day itineraries, flights, hotels, and local tips for any destination.\n\nTry: 'Plan a 5-day trip to Lisbon'",
    pt: "Planejamento de viagem completo!\n\nRoteiros dia-a-dia, voos, hotéis e dicas locais para qualquer destino.\n\nTesta: 'Faz um roteiro de 5 dias em Lisboa'",
    es: "¡Planificación de viajes completa!\n\nItinerarios día a día, vuelos, hoteles y tips locales para cualquier destino.\n\nPrueba: 'Planifica un viaje de 5 días a Lisboa'" },
  { step: 7, day: 15, banner: "banner_day15_smartglasses.png",
    en: "Got Ray-Ban Meta? Use Sniffer hands-free! 😎\n\n🎙️ 'Hey Meta, send message to Sniffer: find Nike shoes'\n📸 Photo → 'Hey Meta, send that to Sniffer'\n🛒 'Hey Meta, tell Sniffer: buy the perfume'\n\nSave my number as 'Sniffer' in your contacts!",
    pt: "Tem Ray-Ban Meta? Use o Sniffer sem as mãos! 😎\n\n🎙️ 'Hey Meta, send message to Sniffer: busca tênis Nike'\n📸 Foto → 'Hey Meta, send that to Sniffer'\n🛒 'Hey Meta, tell Sniffer: compra o perfume'\n\nSalva meu número como 'Sniffer' nos contatos!",
    es: "Tienes Ray-Ban Meta? Usa Sniffer manos libres! 😎\n\n🎙️ 'Hey Meta, send message to Sniffer: busca tenis Nike'\n📸 Foto → 'Hey Meta, send that to Sniffer'\n🛒 'Hey Meta, tell Sniffer: compra el perfume'\n\nGuarda mi numero como 'Sniffer' en contactos!" },
  { step: 8, day: 18, banner: "banner_day18_documents.png",
    en: "Document assistant activated!\n\nContracts, reports, letters — generated as PDF and sent directly to you.\n\nTry: 'Write a service contract'",
    pt: "Assistente de documentos ativo!\n\nContratos, relatórios, cartas — gerados em PDF e enviados direto pra você.\n\nTesta: 'Escreve um contrato de serviços'",
    es: "¡Asistente de documentos activado!\n\nContratos, reportes, cartas — generados en PDF y enviados directamente.\n\nPrueba: 'Escribe un contrato de servicios'" },
  { step: 9, day: 21, banner: "banner_day21_fullpower.png",
    en: "Your shopping agent is fully loaded! 🐕\n\nPrice history, coupons, subscription management, and 100+ stores.\n\nWhat are you looking to buy today?",
    pt: "Seu agente de compras está completo! 🐕\n\nHistórico de preços, cupons, gestão de assinaturas e 100+ lojas.\n\nO que você quer comprar hoje?",
    es: "Tu agente de compras esta completo! 🐕\n\nHistorial de precios, cupones, gestion de suscripciones y 100+ tiendas.\n\nQue quieres comprar hoy?" },
];

// Welcome sequence messages for step 0
const WELCOME_EN = [
  { delay: 1000, text: "Hey! I'm Sniffer, your deal-hunting agent 🐕\n\nI sniff out the best price across 100+ stores and alert you when prices drop.\n\nSend me a product name to get started!" },
];

const WELCOME_PT = [
  { delay: 1000, text: "Oi! Eu sou o Sniffer, seu farejador de ofertas 🐕\n\nFarejo o melhor preço em 100+ lojas e aviso quando o preço cair.\n\nManda o nome de um produto pra começar!" },
];

const WELCOME_ES = [
  { delay: 1000, text: "¡Hola! Soy Sniffer — tu cazador de ofertas personal 🐕\n\nHusmeo el mejor precio en 100+ tiendas y te aviso cuando bajan.\n\n¡Envíame el nombre de un producto para empezar!" },
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
  await sendPhoto(platform, chatId, `${BANNER_BASE_URL}/sniffer_welcome.png`);

  // 2. Welcome messages with delays
  const msgs = lang === "pt" ? WELCOME_PT : lang === "es" ? WELCOME_ES : WELCOME_EN;
  for (const msg of msgs) {
    await new Promise((r) => setTimeout(r, msg.delay));
    await sendText(platform, chatId, msg.text);
  }

  // 3. Pricing + name question
  await new Promise((r) => setTimeout(r, 8000));

  let pricingMsg: string;
  if (lang === "pt") {
    pricingMsg = hasReferral
      ? `${referredByName} te convidou — você está no Beta, aproveite acesso completo grátis!\n\nQual é o seu nome?`
      : "Você está no Beta — aproveite acesso completo grátis!\n\nQual é o seu nome?";
  } else if (lang === "es") {
    pricingMsg = hasReferral
      ? `${referredByName} te invitó — estás en Beta, ¡disfruta acceso completo gratis!\n\n¿Cuál es tu nombre?`
      : "Estás en Beta — ¡disfruta acceso completo gratis!\n\n¿Cuál es tu nombre?";
  } else {
    pricingMsg = hasReferral
      ? `${referredByName} invited you — you're in Beta, enjoy full access for free!\n\nWhat's your name?`
      : "You're in Beta — enjoy full access for free!\n\nWhat's your name?";
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

      // Send banner (use PT variant if available)
      const lang = await detectLang(seq.chatId);
      const bannerFile = lang === "pt" && stepToSend.bannerPt ? stepToSend.bannerPt : stepToSend.banner;
      await sendPhoto(seq.platform, seq.chatId, `${BANNER_BASE_URL}/${bannerFile}`);
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
