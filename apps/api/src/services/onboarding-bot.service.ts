/**
 * Onboarding Bot Service — Conversational onboarding via Telegram/WhatsApp
 *
 * Flow (100% in chat, multilingual: EN/PT/ES):
 * name → bot_nickname → email_password → email_confirm → beta_choice → limits → stores → kyc_info → shipping_address → payment → complete
 */

import { prisma } from "@payjarvis/database";
import { randomBytes, createHash } from "crypto";
import { sendOnboardingConfirmation } from "./email.js";
import { StripeProvider } from "./payments/providers/stripe.provider.js";
import { getPaymentProvider } from "./payments/payment-factory.js";
import { initCredits } from "./credit.service.js";
import { initSequence } from "./sequence.service.js";

export interface BotResponse {
  message: string;
  step: string;
  complete: boolean;
}

// ─── Language Detection ──────────────────────────────────

type Lang = "en" | "pt" | "es";

const PT_WORDS = ["oi", "olá", "ola", "tudo bem", "bom dia", "boa tarde", "boa noite", "obrigado", "obrigada", "por favor", "como vai", "e aí", "eai", "fala", "salve"];
const ES_WORDS = ["hola", "buenos días", "buenos dias", "buenas tardes", "buenas noches", "cómo estás", "como estas", "gracias", "por favor", "qué tal", "que tal"];
const PT_PHONE_PREFIXES = ["+55"];
const ES_PHONE_PREFIXES = ["+34", "+52", "+54", "+56", "+57"];

function detectLanguage(phone: string | null, firstMessage: string): Lang {
  // 1. Phone prefix detection
  if (phone) {
    const cleaned = phone.replace("whatsapp:", "");
    if (PT_PHONE_PREFIXES.some((p) => cleaned.startsWith(p))) return "pt";
    if (ES_PHONE_PREFIXES.some((p) => cleaned.startsWith(p))) return "es";
  }

  // 2. Message content detection
  const lower = firstMessage.trim().toLowerCase();
  if (PT_WORDS.some((w) => lower.includes(w))) return "pt";
  if (ES_WORDS.some((w) => lower.includes(w))) return "es";

  // 3. Default
  return "en";
}

// ─── i18n Messages ───────────────────────────────────────

const MSG = {
  greeting: {
    en: (referral: string) =>
      `${referral}Hey! I'm Sniffer, your deal-hunting agent 🐕\n\nTell me what you're looking for and I'll find the best price across 100+ stores. I also monitor deals and alert you when prices drop.\n\nTo get started:\n🔍 Tell me a product you want\n📸 Send a photo of something you saw\n🔗 Send a link for me to track the price\n\nWhat's your name?`,
    pt: (referral: string) =>
      `${referral}Oi! Eu sou o Sniffer, seu farejador de ofertas 🐕\n\nMe diz o que você tá procurando e eu acho o melhor preço em 100+ lojas. Também monitoro promoções e aviso quando cair.\n\nPra começar:\n🔍 Me diz um produto que você quer\n📸 Manda uma foto de algo que viu\n🔗 Manda um link pra eu monitorar o preço\n\nQual é o seu nome?`,
    es: (referral: string) =>
      `${referral}Hola! Soy Sniffer, tu agente rastreador de ofertas 🐕\n\nDime lo que buscas y encuentro el mejor precio en 100+ tiendas. Tambien monitoreo ofertas y te aviso cuando bajan.\n\nPara empezar:\n🔍 Dime un producto que quieres\n📸 Manda una foto de algo que viste\n🔗 Manda un link para monitorear el precio\n\nCual es tu nombre?`,
  },
  referralIntro: {
    en: (name: string) => `Your friend ${name} invited you to try SnifferShop!\n\n`,
    pt: (name: string) => `Seu amigo ${name} te convidou para experimentar o SnifferShop!\n\n`,
    es: (name: string) => `¡Tu amigo ${name} te invitó a probar SnifferShop!\n\n`,
  },
  nameTooShort: {
    en: "Name too short. What's your name?",
    pt: "Nome muito curto. Qual é o seu nome?",
    es: "Nombre muy corto. ¿Cuál es tu nombre?",
  },
  nameTooLong: {
    en: "Name too long. What's your name?",
    pt: "Nome muito longo. Qual é o seu nome?",
    es: "Nombre muy largo. ¿Cuál es tu nombre?",
  },
  niceToMeet: {
    en: (name: string) => `Nice to meet you, ${name}! 😊\n\nWould you like to give me a special name or keep calling me Sniffer?`,
    pt: (name: string) => `Prazer em te conhecer, ${name}! 😊\n\nVocê quer me dar um nome especial ou pode me chamar de Sniffer?`,
    es: (name: string) => `¡Mucho gusto, ${name}! 😊\n\n¿Quieres darme un nombre especial o prefieres llamarme Sniffer?`,
  },
  keepJarvis: {
    en: "Alright, just call me Sniffer! 😄",
    pt: "Beleza, pode me chamar de Sniffer! 😄",
    es: "¡Perfecto, llámame Sniffer! 😄",
  },
  loveNickname: {
    en: (name: string) => `Love it! From now on, call me ${name}! 🎉`,
    pt: (name: string) => `Adorei! De agora em diante, me chama de ${name}! 🎉`,
    es: (name: string) => `¡Me encanta! De ahora en adelante, llámame ${name}! 🎉`,
  },
  invalidNickname: {
    en: "Just type a short name like Luna, Max, or say 'Sniffer is fine' 😊",
    pt: "Digita um nome curto como Luna, Max, ou diz 'Sniffer tá bom' 😊",
    es: "Escribe un nombre corto como Luna, Max, o di 'Sniffer está bien' 😊",
  },
  emailPasswordPrompt: {
    en: (prefix: string) =>
      `${prefix}\n\nNow let's create your SnifferShop account! 🔐\n\nI need two things:\n📧 Your email (to log into SnifferShop)\n🔑 Create a NEW password (this is NOT your email password — it's a new one just for SnifferShop)\n\nSend both together, like this:\nmyemail@gmail.com MyNewPassword123\n\n⚠️ Important: Do NOT send your email password. Create a new, unique password for your SnifferShop account.`,
    pt: (prefix: string) =>
      `${prefix}\n\nAgora vamos criar sua conta no SnifferShop! 🔐\n\nPreciso de duas coisas:\n📧 Seu email (para entrar no SnifferShop)\n🔑 Crie uma senha NOVA (NÃO é a senha do seu email — é uma senha nova só para o SnifferShop)\n\nManda os dois juntos, assim:\nmeuemail@gmail.com MinhaSenha123\n\n⚠️ Importante: NÃO envie a senha do seu email. Crie uma senha nova e única para sua conta SnifferShop.`,
    es: (prefix: string) =>
      `${prefix}\n\n¡Ahora vamos a crear tu cuenta en SnifferShop! 🔐\n\nNecesito dos cosas:\n📧 Tu email (para entrar en SnifferShop)\n🔑 Crea una contraseña NUEVA (NO es la contraseña de tu email — es una nueva solo para SnifferShop)\n\nEnvía ambos juntos, así:\nmiemail@gmail.com MiContraseña123\n\n⚠️ Importante: NO envíes la contraseña de tu email. Crea una contraseña nueva y única para tu cuenta SnifferShop.`,
  },
  emailPasswordRetryNoAt: {
    en: "No worries! When you're ready, send your email and create a NEW password for SnifferShop.\n\n⚠️ Don't use your email password — create a new one just for SnifferShop.\n\nExample: john@gmail.com MyNewPassword123",
    pt: "Sem problema! Quando estiver pronto, manda seu email e cria uma senha NOVA para o SnifferShop.\n\n⚠️ Não use a senha do seu email — crie uma nova só para o SnifferShop.\n\nExemplo: joao@gmail.com MinhaSenha123",
    es: "¡No te preocupes! Cuando estés listo, envía tu email y crea una contraseña NUEVA para SnifferShop.\n\n⚠️ No uses la contraseña de tu email — crea una nueva solo para SnifferShop.\n\nEjemplo: juan@gmail.com MiContraseña123",
  },
  emailInvalid: {
    en: "Hmm, that doesn't look like a valid email. Send your email and a NEW password for SnifferShop together:\n\n⚠️ Don't use your email password — create a new one.\n\nExample: john@gmail.com MyNewPassword123",
    pt: "Hmm, isso não parece um email válido. Manda seu email e uma senha NOVA para o SnifferShop juntos:\n\n⚠️ Não use a senha do seu email — crie uma nova.\n\nExemplo: joao@gmail.com MinhaSenha123",
    es: "Hmm, eso no parece un email válido. Envía tu email y una contraseña NUEVA para SnifferShop juntos:\n\n⚠️ No uses la contraseña de tu email — crea una nueva.\n\nEjemplo: juan@gmail.com MiContraseña123",
  },
  passwordMissing: {
    en: "I also need a NEW password for SnifferShop (minimum 6 characters).\n\n⚠️ Don't use your email password — create a new one just for SnifferShop.\n\nExample: john@gmail.com MyNewPassword123",
    pt: "Também preciso de uma senha NOVA para o SnifferShop (mínimo 6 caracteres).\n\n⚠️ Não use a senha do seu email — crie uma nova só para o SnifferShop.\n\nExemplo: joao@gmail.com MinhaSenha123",
    es: "También necesito una contraseña NUEVA para SnifferShop (mínimo 6 caracteres).\n\n⚠️ No uses la contraseña de tu email — crea una nueva solo para SnifferShop.\n\nEjemplo: juan@gmail.com MiContraseña123",
  },
  passwordTooShort: {
    en: "Password must be at least 6 characters. Try again with a NEW password for SnifferShop:\n\n⚠️ Remember: this is NOT your email password.\n\nExample: john@gmail.com MyNewPassword123",
    pt: "A senha precisa ter pelo menos 6 caracteres. Tenta de novo com uma senha NOVA para o SnifferShop:\n\n⚠️ Lembre: NÃO é a senha do seu email.\n\nExemplo: joao@gmail.com MinhaSenha123",
    es: "La contraseña debe tener al menos 6 caracteres. Intenta de nuevo con una contraseña NUEVA para SnifferShop:\n\n⚠️ Recuerda: NO es la contraseña de tu email.\n\nEjemplo: juan@gmail.com MiContraseña123",
  },
  emailCodeSent: {
    en: "I sent a 6-digit code to your email. What is it?\n\n💡 If you can't find it in your inbox, check your Spam folder!",
    pt: "Enviei um código de 6 dígitos pro seu email. Qual é o código?\n\n💡 Se não encontrar na caixa de entrada, olha na pasta de Spam!",
    es: "Envié un código de 6 dígitos a tu email. ¿Cuál es el código?\n\n💡 Si no lo encuentras en tu bandeja, ¡revisa la carpeta de Spam!",
  },
  emailCodeWrong: {
    en: (remaining: number) => `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.\n\nEnter the 6-digit code:`,
    pt: (remaining: number) => `Código incorreto. ${remaining} tentativa${remaining === 1 ? "" : "s"} restante${remaining === 1 ? "" : "s"}.\n\nDigite o código de 6 dígitos:`,
    es: (remaining: number) => `Código incorrecto. ${remaining} intento${remaining === 1 ? "" : "s"} restante${remaining === 1 ? "" : "s"}.\n\nIngresa el código de 6 dígitos:`,
  },
  emailCodeTooMany: {
    en: "Too many incorrect attempts. I sent a new code to your email.\n\nEnter the new 6-digit code:",
    pt: "Muitas tentativas incorretas. Enviei um novo código pro seu email.\n\nDigite o novo código de 6 dígitos:",
    es: "Demasiados intentos incorrectos. Envié un nuevo código a tu email.\n\nIngresa el nuevo código de 6 dígitos:",
  },
  accountCreated: {
    en: "Account created! 🎉\n\nYou arrived at the right time! We're in Beta and access is completely free. Try me out with no commitment!\n\nWant to set up your shopping system now or explore first?\n\n1️⃣ Set up now\n2️⃣ Explore first — I'll set up later",
    pt: "Conta criada! 🎉\n\nVocê chegou na hora certa! Estamos em Beta e o acesso é totalmente gratuito. Me experimenta sem compromisso!\n\nQuer configurar o sistema de compras agora ou explorar primeiro?\n\n1️⃣ Configurar agora\n2️⃣ Explorar primeiro — configuro depois",
    es: "¡Cuenta creada! 🎉\n\n¡Llegaste en el momento justo! Estamos en Beta y el acceso es completamente gratis. ¡Pruébame sin compromiso!\n\n¿Quieres configurar tu sistema de compras ahora o explorar primero?\n\n1️⃣ Configurar ahora\n2️⃣ Explorar primero — configuro después",
  },
  limitsPrompt: {
    en: "What spending limit per purchase would you like? (e.g.: $50, $100, $200)",
    pt: "Qual limite de gasto por compra você quer? (ex.: $50, $100, $200)",
    es: "¿Qué límite de gasto por compra te gustaría? (ej.: $50, $100, $200)",
  },
  limitsInvalid: {
    en: "Invalid amount. Choose a number between 1 and 10,000:\n\nExample: $50, $100, $200",
    pt: "Valor inválido. Escolha um número entre 1 e 10.000:\n\nExemplo: $50, $100, $200",
    es: "Monto inválido. Elige un número entre 1 y 10.000:\n\nEjemplo: $50, $100, $200",
  },
  limitsSet: {
    en: (val: string) => `Great! $${val} per purchase limit set.\n\nRight now I can shop on Amazon for you! More stores coming soon.\n\nWant to connect your Amazon account now?\n\n1️⃣ Yes — let's set it up\n2️⃣ Later — I'll explore first`,
    pt: (val: string) => `Ótimo! Limite de $${val} por compra definido.\n\nAgora eu consigo comprar na Amazon por você! Mais lojas em breve.\n\nQuer conectar sua conta da Amazon agora?\n\n1️⃣ Sim — vamos configurar\n2️⃣ Depois — vou explorar primeiro`,
    es: (val: string) => `¡Genial! Límite de $${val} por compra establecido.\n\nAhora puedo comprar en Amazon por ti. ¡Más tiendas pronto!\n\n¿Quieres conectar tu cuenta de Amazon ahora?\n\n1️⃣ Sí — vamos a configurar\n2️⃣ Después — voy a explorar primero`,
  },
  storesSkip: {
    en: "No problem! You can connect Amazon anytime from Settings.\n\n",
    pt: "Sem problema! Você pode conectar a Amazon a qualquer momento nas Configurações.\n\n",
    es: "¡No hay problema! Puedes conectar Amazon en cualquier momento desde Configuración.\n\n",
  },
  storesConnected: {
    en: "Amazon connected! ✅ I can now shop for you anytime.\n\n",
    pt: "Amazon conectada! ✅ Agora posso comprar pra você a qualquer momento.\n\n",
    es: "¡Amazon conectada! ✅ Ahora puedo comprar por ti en cualquier momento.\n\n",
  },
  storesComingSoon: {
    en: "That store is coming soon! Right now I can shop on Amazon.\n\nWant to connect Amazon?\n\n1️⃣ Yes\n2️⃣ Later",
    pt: "Essa loja está chegando em breve! Agora eu consigo comprar na Amazon.\n\nQuer conectar a Amazon?\n\n1️⃣ Sim\n2️⃣ Depois",
    es: "¡Esa tienda llegará pronto! Ahora puedo comprar en Amazon.\n\n¿Quieres conectar Amazon?\n\n1️⃣ Sí\n2️⃣ Después",
  },
  storesDefault: {
    en: "Right now I can shop on Amazon. Want to connect it?\n\n1️⃣ Yes — let's set it up\n2️⃣ Later — I'll explore first",
    pt: "Agora eu consigo comprar na Amazon. Quer conectar?\n\n1️⃣ Sim — vamos configurar\n2️⃣ Depois — vou explorar primeiro",
    es: "Ahora puedo comprar en Amazon. ¿Quieres conectarla?\n\n1️⃣ Sí — vamos a configurar\n2️⃣ Después — voy a explorar primero",
  },
  kycPrompt: {
    en: (prefix: string) => `${prefix}To keep your account secure and enable purchases, I need a few details.\n\n🌍 What country are you in?\n\n1️⃣ US (United States)\n2️⃣ BR (Brazil)\n\nOr type "skip" to do this later.`,
    pt: (prefix: string) => `${prefix}Para manter sua conta segura e habilitar compras, preciso de alguns dados.\n\n🌍 Em qual país você está?\n\n1️⃣ US (Estados Unidos)\n2️⃣ BR (Brasil)\n\nOu digite "pular" para fazer depois.`,
    es: (prefix: string) => `${prefix}Para mantener tu cuenta segura y habilitar compras, necesito algunos datos.\n\n🌍 ¿En qué país estás?\n\n1️⃣ US (Estados Unidos)\n2️⃣ BR (Brasil)\n\nO escribe "saltar" para hacerlo después.`,
  },
  kycDobPrompt: {
    en: (country: string) => `Got it — ${country}! 🗓️ Now, what's your date of birth?\n\nFormat: MM/DD/YYYY (e.g., 03/15/1990)\n\nOr type "skip".`,
    pt: (country: string) => `Entendi — ${country}! 🗓️ Agora, qual a sua data de nascimento?\n\nFormato: DD/MM/AAAA (ex.: 15/03/1990)\n\nOu digite "pular".`,
    es: (country: string) => `¡Entendido — ${country}! 🗓️ Ahora, ¿cuál es tu fecha de nacimiento?\n\nFormato: DD/MM/AAAA (ej.: 15/03/1990)\n\nO escribe "saltar".`,
  },
  kycDocPrompt: {
    en: "Last one — what's your ID or document number?\n\nThis helps verify your identity for purchases.\n\nOr type \"skip\".",
    pt: "Ultimo — qual o numero do seu CPF?\n\nIsso ajuda a verificar sua identidade para compras.\n\nOu digite \"pular\".",
    es: "Ultimo — ¿cuál es tu número de documento de identidad?\n\nEsto ayuda a verificar tu identidad para compras.\n\nO escribe \"saltar\".",
  },
  kycDobInvalid: {
    en: "Invalid date. Please use MM/DD/YYYY format (e.g., 03/15/1990).\n\nOr type \"skip\".",
    pt: "Data invalida. Use o formato DD/MM/AAAA (ex.: 15/03/1990).\n\nOu digite \"pular\".",
    es: "Fecha invalida. Usa el formato DD/MM/AAAA (ej.: 15/03/1990).\n\nO escribe \"saltar\".",
  },
  kycTooYoung: {
    en: "You must be at least 18 years old to use SnifferShop.",
    pt: "Você precisa ter pelo menos 18 anos para usar o SnifferShop.",
    es: "Debes tener al menos 18 años para usar SnifferShop.",
  },
  kycDocInvalid: {
    en: "That doesn't look right. Please enter a valid document number.\n\nOr type \"skip\".",
    pt: "Isso nao parece correto. CPF deve ter 11 digitos.\n\nOu digite \"pular\".",
    es: "Eso no parece correcto. Ingresa un número de documento válido.\n\nO escribe \"saltar\".",
  },
  kycComplete: {
    en: "Profile updated! ✅\n\n",
    pt: "Perfil atualizado! ✅\n\n",
    es: "¡Perfil actualizado! ✅\n\n",
  },
  resumeKyc: {
    en: "Let's finish your profile. What country are you in?\n\n1️⃣ US (United States)\n2️⃣ BR (Brazil)\n\nOr type \"skip\".",
    pt: "Vamos terminar seu perfil. Em qual país você está?\n\n1️⃣ US (Estados Unidos)\n2️⃣ BR (Brasil)\n\nOu digite \"pular\".",
    es: "Terminemos tu perfil. ¿En qué país estás?\n\n1️⃣ US (Estados Unidos)\n2️⃣ BR (Brasil)\n\nO escribe \"saltar\".",
  },
  shippingPrompt: {
    en: (prefix: string) => `${prefix}Where should I deliver your purchases? Send me your shipping address:\n\n📍 Street, City, State, ZIP code\n\n(Example: 1234 Main St, Miami, FL 33101)\n\nOr type "skip" to add later.`,
    pt: (prefix: string) => `${prefix}Onde devo entregar suas compras? Me manda seu endereço de entrega:\n\n📍 Rua, Bairro, Cidade, Estado, CEP\n\n(Exemplo: Rua das Flores 123, Centro, Sao Paulo, SP, 01000000)\n\nOu digite "pular" para adicionar depois.`,
    es: (prefix: string) => `${prefix}¿Dónde debo entregar tus compras? Envíame tu dirección de envío:\n\n📍 Calle, Ciudad, Estado, Código Postal\n\n(Ejemplo: Calle Principal 123, Ciudad de México, CDMX 06000)\n\nO escribe "saltar" para agregar después.`,
  },
  shippingTooShort: {
    en: "That seems too short for an address. Please include street, city, state and ZIP code.\n\n(Example: 1234 Main St, Miami, FL 33101)\n\nOr type \"skip\" to add later.",
    pt: "Parece muito curto para um endereço. Inclua rua, cidade, estado e CEP.\n\n(Exemplo: Rua das Flores 123, São Paulo, SP 01000-000)\n\nOu digite \"pular\" para adicionar depois.",
    es: "Eso parece muy corto para una dirección. Incluye calle, ciudad, estado y código postal.\n\n(Ejemplo: Calle Principal 123, Ciudad de México, CDMX 06000)\n\nO escribe \"saltar\" para agregar después.",
  },
  shippingConfirm: {
    en: (addr: string) => `Got it! All purchases will be delivered to:\n📍 ${addr}\n\nYou can change this anytime by saying "update my address".\n\n`,
    pt: (addr: string) => `Entendido! Todas as compras serão entregues em:\n📍 ${addr}\n\nVocê pode mudar a qualquer momento dizendo "atualiza meu endereço".\n\n`,
    es: (addr: string) => `¡Entendido! Todas las compras se entregarán en:\n📍 ${addr}\n\nPuedes cambiar en cualquier momento diciendo "actualiza mi dirección".\n\n`,
  },
  paymentPrompt: {
    en: (link: string) => `Last step — add your card so I can shop for you.\n\nClick here to register securely (powered by Stripe): ${link}\n\nOr type "skip" to add later.`,
    pt: (link: string) => `Último passo — adicione seu cartão para que eu possa comprar por você.\n\nClique aqui para cadastrar com segurança (powered by Stripe): ${link}\n\nOu digite "pular" para adicionar depois.`,
    es: (link: string) => `Último paso — agrega tu tarjeta para que pueda comprar por ti.\n\nHaz clic aquí para registrar de forma segura (powered by Stripe): ${link}\n\nO escribe "saltar" para agregar después.`,
  },
  paymentFallback: {
    en: "Last step — add a payment method.\n\nYou can set this up later in the dashboard.\n\nType \"skip\" to finish.",
    pt: "Último passo — adicione um método de pagamento.\n\nVocê pode configurar isso depois no painel.\n\nDigite \"pular\" para finalizar.",
    es: "Último paso — agrega un método de pago.\n\nPuedes configurar esto después en el panel.\n\nEscribe \"saltar\" para terminar.",
  },
  paymentNotDetected: {
    en: "I haven't detected the payment yet. Try clicking the link above to add your card.\n\nOr type \"skip\" to set up later.",
    pt: "Ainda não detectei o pagamento. Tenta clicar no link acima para adicionar seu cartão.\n\nOu digite \"pular\" para configurar depois.",
    es: "Aún no detecté el pago. Intenta hacer clic en el enlace de arriba para agregar tu tarjeta.\n\nO escribe \"saltar\" para configurar después.",
  },
  paymentClickLink: {
    en: "Click the link above to add your card.\n\nType \"done\" when finished or \"skip\" to do it later.",
    pt: "Clique no link acima para adicionar seu cartão.\n\nDigite \"pronto\" quando terminar ou \"pular\" para fazer depois.",
    es: "Haz clic en el enlace de arriba para agregar tu tarjeta.\n\nEscribe \"listo\" cuando termines o \"saltar\" para hacerlo después.",
  },
  complete: {
    en: (nickname: string) => `${nickname} is ready to help! 🚀\n\nYou arrived at the right time! We're in Beta — completely free, no commitment!\n\nWould you like to set up shopping so I can buy things for you? 🛒\nClick here: https://www.payjarvis.com/dashboard/setup-shopping\nIt takes 2 minutes and your card info is protected by Stripe 🔒\n\nAsk me anything — I'm here 24/7 for you!`,
    pt: (nickname: string) => `${nickname} está pronto pra te ajudar! 🚀\n\nVocê chegou na hora certa! Estamos em Beta — totalmente gratuito, sem compromisso!\n\nQuer configurar as compras pra eu poder comprar pra você? 🛒\nClique aqui: https://www.payjarvis.com/dashboard/setup-shopping\nLeva 2 minutos e seus dados do cartão são protegidos pelo Stripe 🔒\n\nMe pergunta qualquer coisa — estou aqui 24/7 pra você!`,
    es: (nickname: string) => `¡${nickname} está listo para ayudarte! 🚀\n\n¡Llegaste en el momento justo! Estamos en Beta — completamente gratis, sin compromiso.\n\n¿Quieres configurar las compras para que pueda comprar por ti? 🛒\nHaz clic aquí: https://www.payjarvis.com/dashboard/setup-shopping\nToma 2 minutos y tus datos están protegidos por Stripe 🔒\n\n¡Pregúntame lo que sea — estoy aquí 24/7 para ti!`,
  },
  noSession: {
    en: "No active onboarding session.",
    pt: "Nenhuma sessão de onboarding ativa.",
    es: "No hay sesión de onboarding activa.",
  },
  sessionExpired: {
    en: "Session expired. Start again with /start.",
    pt: "Sessão expirada. Comece novamente com /start.",
    es: "Sesión expirada. Empieza de nuevo con /start.",
  },
  // Resume messages
  resumeName: {
    en: "Looks like you already started! What's your name?",
    pt: "Parece que você já começou! Qual é o seu nome?",
    es: "¡Parece que ya empezaste! ¿Cuál es tu nombre?",
  },
  resumeNickname: {
    en: (name: string) => `${name}! Would you like to give me a special name or keep calling me Sniffer?`,
    pt: (name: string) => `${name}! Quer me dar um nome especial ou pode me chamar de Sniffer?`,
    es: (name: string) => `¡${name}! ¿Quieres darme un nombre especial o prefieres llamarme Sniffer?`,
  },
  resumeEmailPassword: {
    en: "Let's create your SnifferShop account! 🔐\n\nSend your email and a NEW password (not your email password — a new one just for SnifferShop):\n\nExample: myemail@gmail.com MyNewPassword123",
    pt: "Vamos criar sua conta no SnifferShop! 🔐\n\nManda seu email e uma senha NOVA (não é a senha do seu email — é uma nova só para o SnifferShop):\n\nExemplo: meuemail@gmail.com MinhaSenha123",
    es: "¡Vamos a crear tu cuenta en SnifferShop! 🔐\n\nEnvía tu email y una contraseña NUEVA (no es la contraseña de tu email — es una nueva solo para SnifferShop):\n\nEjemplo: miemail@gmail.com MiContraseña123",
  },
  resumeEmailConfirm: {
    en: (email: string) => `I already sent the code to ${email}. Enter the 6-digit code:`,
    pt: (email: string) => `Já enviei o código para ${email}. Digite o código de 6 dígitos:`,
    es: (email: string) => `Ya envié el código a ${email}. Ingresa el código de 6 dígitos:`,
  },
  resumeBetaChoice: {
    en: "Want to set up your shopping system now or explore first?\n\n1️⃣ Set up now\n2️⃣ Explore first",
    pt: "Quer configurar o sistema de compras agora ou explorar primeiro?\n\n1️⃣ Configurar agora\n2️⃣ Explorar primeiro",
    es: "¿Quieres configurar tu sistema de compras ahora o explorar primero?\n\n1️⃣ Configurar ahora\n2️⃣ Explorar primero",
  },
  resumeLimits: {
    en: "What spending limit per purchase would you like? (e.g.: $50, $100, $200)",
    pt: "Qual limite de gasto por compra você quer? (ex.: $50, $100, $200)",
    es: "¿Qué límite de gasto por compra te gustaría? (ej.: $50, $100, $200)",
  },
  resumeStores: {
    en: "Which stores can I shop for you?\n\n🟢 Amazon\n🔜 eBay, Walmart, Target, Best Buy — coming soon\n\nOr type a store website. Type \"done\" to continue.",
    pt: "Em quais lojas posso comprar pra você?\n\n🟢 Amazon\n🔜 eBay, Walmart, Target, Best Buy — em breve\n\nOu digita o site de uma loja. Digite \"pronto\" para continuar.",
    es: "¿En qué tiendas puedo comprar por ti?\n\n🟢 Amazon\n🔜 eBay, Walmart, Target, Best Buy — próximamente\n\nO escribe el sitio de una tienda. Escribe \"listo\" para continuar.",
  },
  resumeShipping: {
    en: "Where should I deliver your purchases? Send your address (Street, City, State, ZIP).\n\nOr type \"skip\" to add later.",
    pt: "Onde devo entregar suas compras? Mande seu endereço (Rua, Cidade, Estado, CEP).\n\nOu digite \"pular\" para adicionar depois.",
    es: "¿Dónde debo entregar tus compras? Envía tu dirección (Calle, Ciudad, Estado, CP).\n\nO escribe \"saltar\" para agregar después.",
  },
  resumePayment: {
    en: "Just need to add your card. Click the link I sent or type \"skip\" to do it later.",
    pt: "Só falta adicionar seu cartão. Clique no link que enviei ou digite \"pular\" para fazer depois.",
    es: "Solo falta agregar tu tarjeta. Haz clic en el enlace que envié o escribe \"saltar\" para hacerlo después.",
  },
  resumeDefault: {
    en: "What's your name so we can get started?",
    pt: "Qual é o seu nome para começarmos?",
    es: "¿Cuál es tu nombre para empezar?",
  },
} as const;

function t(key: keyof typeof MSG, lang: Lang): any {
  const entry = MSG[key] as Record<string, unknown>;
  return entry[lang] ?? entry["en"];
}

// ─── Helpers ─────────────────────────────────────────────

function generateEmailCode(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return num.toString();
}

async function getSharedByName(shareCode: string): Promise<string | null> {
  const link = await prisma.botShareLink.findUnique({
    where: { code: shareCode },
    select: { templateConfig: true },
  });
  if (!link) return null;
  const config = link.templateConfig as Record<string, unknown>;
  return (config.sharedByName as string) ?? null;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
): Promise<T> {
  const delays = [1000, 2000, 4000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[Onboarding] CRITICAL: ${label} failed after ${maxRetries + 1} attempts:`, (err as Error).message);
        throw err;
      }
      const delay = delays[attempt] ?? 4000;
      console.warn(`[Onboarding] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function getSessionLang(sessionId: string): Promise<Lang> {
  const s = await prisma.onboardingSession.findUnique({ where: { id: sessionId }, select: { language: true } });
  return (s?.language as Lang) ?? "en";
}

// ─── Start ───────────────────────────────────────────────

export async function startOnboarding(
  chatId: string,
  platform: "telegram" | "whatsapp",
  shareCode?: string,
  firstMessage?: string,
  botNumber?: string,
): Promise<{ sessionId: string; message: string }> {
  const existing = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (existing && existing.step !== "complete" && existing.expiresAt > new Date()) {
    const lang = (existing.language as Lang) ?? "en";
    const response = await getStepMessage(existing.step, existing, lang);
    return { sessionId: existing.id, message: response };
  }

  if (existing) {
    await prisma.onboardingSession.delete({ where: { id: existing.id } });
  }

  // Detect language: BR bot number → always PT, otherwise from user phone/message
  const isBrBot = botNumber?.includes("+5511") ?? false;
  const phone = platform === "whatsapp" ? chatId : null;
  const lang = isBrBot ? "pt" as Lang : detectLanguage(phone, firstMessage ?? "");

  let sharedByName: string | null = null;
  if (shareCode) {
    sharedByName = await getSharedByName(shareCode);
  }

  const session = await prisma.onboardingSession.create({
    data: {
      telegramChatId: platform === "telegram" ? chatId : null,
      whatsappPhone: platform === "whatsapp" ? chatId : null,
      shareCode: shareCode ?? null,
      language: lang,
      step: "name",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h
    },
  });

  const referralIntro = sharedByName
    ? (t("referralIntro", lang) as (name: string) => string)(sharedByName)
    : "";

  const greeting = (t("greeting", lang) as (referral: string) => string)(referralIntro);

  return { sessionId: session.id, message: greeting };
}

// ─── Process Step ────────────────────────────────────────

export async function processStep(
  chatId: string,
  platform: string,
  userInput: string
): Promise<BotResponse> {
  const session = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (!session || session.step === "complete") {
    return { message: MSG.noSession.en, step: "none", complete: false };
  }

  const lang = (session.language as Lang) ?? "en";

  if (session.expiresAt < new Date()) {
    await prisma.onboardingSession.delete({ where: { id: session.id } });
    return { message: t("sessionExpired", lang) as string, step: "expired", complete: false };
  }

  switch (session.step) {
    case "name":
      return handleNameStep(session.id, userInput, lang);
    case "bot_nickname":
      return handleBotNicknameStep(session.id, userInput, lang);
    case "email_password":
      return handleEmailPasswordStep(session.id, userInput, lang);
    case "email_confirm":
      return handleEmailConfirmStep(session.id, userInput, lang);
    case "beta_choice":
      return handleBetaChoiceStep(session.id, userInput, lang);
    case "limits":
      return handleLimitsStep(session.id, userInput, lang);
    case "stores":
      return handleStoresStep(session.id, userInput, lang);
    case "kyc_info":
      return handleKycCountryStep(session.id, userInput, lang);
    case "kyc_dob":
      return handleKycDobStep(session.id, userInput, lang);
    case "kyc_doc":
      return handleKycDocStep(session.id, userInput, lang);
    case "shipping_address":
      return handleShippingAddressStep(session.id, userInput, lang);
    case "payment":
      return handlePaymentStep(session.id, userInput, lang);
    default:
      return { message: "Unexpected state. Try /start again.", step: session.step, complete: false };
  }
}

// ─── Step: name ──────────────────────────────────────────

async function handleNameStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const name = input.trim();

  if (name.length < 2) {
    return { message: t("nameTooShort", lang) as string, step: "name", complete: false };
  }
  if (name.length > 100) {
    return { message: t("nameTooLong", lang) as string, step: "name", complete: false };
  }

  // Re-detect language from first real message if it looks like PT/ES
  const detected = detectLanguage(null, input);
  if (detected !== "en") {
    await prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { fullName: name, step: "bot_nickname", language: detected },
    });
    const msg = (t("niceToMeet", detected) as (n: string) => string)(name);
    return { message: msg, step: "bot_nickname", complete: false };
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { fullName: name, step: "bot_nickname" },
  });

  const msg = (t("niceToMeet", lang) as (n: string) => string)(name);
  return { message: msg, step: "bot_nickname", complete: false };
}

// ─── Step: bot_nickname ──────────────────────────────────

async function handleBotNicknameStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const keepDefault = ["no", "nah", "jarvis", "sniffer", "keep", "that's fine", "fine", "n", "não", "nao", "pode ser", "no", "está bien", "esta bien"];
  const notAName = ["falar", "português", "portugues", "english", "spanish", "please", "can you", "speak", "language", "idioma", "sim", "yes", "como", "what", "help", "ajuda", "quero", "want", "could", "would", "hablar", "español"];

  let nickname: string;
  let response: string;

  if (keepDefault.some((k) => lower === k || lower.startsWith(k))) {
    nickname = "Sniffer";
    response = t("keepJarvis", lang) as string;
  } else if (input.trim().length > 20 || notAName.some((w) => lower.includes(w))) {
    return {
      message: t("invalidNickname", lang) as string,
      step: "bot_nickname",
      complete: false,
    };
  } else {
    nickname = input.trim().slice(0, 20);
    response = (t("loveNickname", lang) as (n: string) => string)(nickname);
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { botNickname: nickname, step: "email_password" },
  });

  return {
    message: (t("emailPasswordPrompt", lang) as (prefix: string) => string)(response),
    step: "email_password",
    complete: false,
  };
}

// ─── Step: email_password ────────────────────────────────

async function handleEmailPasswordStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const trimmed = input.trim();

  // Detect if user sent a question/sentence instead of email+password
  if (!trimmed.includes("@")) {
    return {
      message: t("emailPasswordRetryNoAt", lang) as string,
      step: "email_password",
      complete: false,
    };
  }

  const parts = trimmed.split(/\s+/);

  let email: string | null = null;
  let password: string | null = null;

  for (const part of parts) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
      email = part.toLowerCase();
    } else if (!password && part.length >= 6) {
      password = part;
    }
  }

  if (!email) {
    return {
      message: t("emailInvalid", lang) as string,
      step: "email_password",
      complete: false,
    };
  }

  if (!password) {
    return {
      message: t("passwordMissing", lang) as string,
      step: "email_password",
      complete: false,
    };
  }

  if (password.length < 6) {
    return {
      message: t("passwordTooShort", lang) as string,
      step: "email_password",
      complete: false,
    };
  }

  const code = generateEmailCode();

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { email, password, emailToken: code, step: "email_confirm" },
  });

  sendOnboardingConfirmation(email, code).catch((err: unknown) => {
    console.error("[Onboarding] Failed to send confirmation email:", err);
  });

  return {
    message: t("emailCodeSent", lang) as string,
    step: "email_confirm",
    complete: false,
  };
}

// ─── Step: email_confirm ─────────────────────────────────

async function handleEmailConfirmStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const code = input.trim();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Session not found.", step: "error", complete: false };

  if (code !== session.emailToken) {
    const attempts = (session.emailAttempts ?? 0) + 1;
    const MAX_ATTEMPTS = 5;

    if (attempts >= MAX_ATTEMPTS) {
      const newCode = generateEmailCode();
      await prisma.onboardingSession.update({
        where: { id: sessionId },
        data: { emailToken: newCode, emailAttempts: 0 },
      });

      if (session.email) {
        sendOnboardingConfirmation(session.email, newCode).catch((err: unknown) => {
          console.error("[Onboarding] Failed to resend confirmation email:", err);
        });
      }

      return {
        message: t("emailCodeTooMany", lang) as string,
        step: "email_confirm",
        complete: false,
      };
    }

    await prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { emailAttempts: attempts },
    });

    const remaining = MAX_ATTEMPTS - attempts;
    return {
      message: (t("emailCodeWrong", lang) as (n: number) => string)(remaining),
      step: "email_confirm",
      complete: false,
    };
  }

  // Create user + bot + policy
  const { userId, botId } = await createUserAndBot(session);

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "beta_choice", userId, botId, password: null },
  });

  return {
    message: t("accountCreated", lang) as string,
    step: "beta_choice",
    complete: false,
  };
}

// ─── Step: beta_choice ───────────────────────────────────

async function handleBetaChoiceStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();

  if (lower === "2" || lower.includes("later") || lower.includes("explore") || lower.includes("depois") || lower.includes("después")) {
    return completeOnboarding(sessionId, lang);
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "limits" },
  });

  return {
    message: t("limitsPrompt", lang) as string,
    step: "limits",
    complete: false,
  };
}

// ─── Step: limits ────────────────────────────────────────

async function handleLimitsStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const value = parseFloat(cleaned);

  if (isNaN(value) || value <= 0 || value > 10000) {
    return {
      message: t("limitsInvalid", lang) as string,
      step: "limits",
      complete: false,
    };
  }

  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.botId) return { message: "Internal error.", step: "error", complete: false };

  const autoApprove = Math.floor(value * 0.5);
  await prisma.policy.updateMany({
    where: { botId: session.botId },
    data: {
      maxPerTransaction: value,
      autoApproveLimit: autoApprove,
    },
  });

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { limitsSet: true, step: "stores" },
  });

  return {
    message: (t("limitsSet", lang) as (val: string) => string)(value.toFixed(0)),
    step: "stores",
    complete: false,
  };
}

// ─── Step: stores ────────────────────────────────────────

async function handleStoresStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.userId) return { message: "Internal error.", step: "error", complete: false };

  // "Later" / Skip / 2
  if (lower === "2" || lower === "later" || lower === "skip" || lower === "done" || lower === "pular" || lower === "pronto" || lower === "depois" || lower === "saltar" || lower === "después") {
    return moveToKycStep(sessionId, t("storesSkip", lang) as string, lang);
  }

  // "Yes" / 1 / Amazon
  if (lower === "1" || lower === "yes" || lower === "sim" || lower === "sí" || lower === "si" || lower === "amazon" || lower.includes("yes") || lower.includes("amazon") || lower.includes("set")) {
    await connectStore(session.userId, "amazon", "https://www.amazon.com", "Amazon", true);

    await prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { storesConfigured: true },
    });

    return moveToKycStep(sessionId, t("storesConnected", lang) as string, lang);
  }

  // Coming soon stores
  const comingSoon = ["ebay", "walmart", "target", "best buy", "bestbuy", "nike", "zara"];
  if (comingSoon.some((s) => lower.includes(s))) {
    return {
      message: t("storesComingSoon", lang) as string,
      step: "stores",
      complete: false,
    };
  }

  return {
    message: t("storesDefault", lang) as string,
    step: "stores",
    complete: false,
  };
}

async function checkStoreCapabilities(
  userId: string,
  storeName: string,
  storeUrl: string,
  storeLabel: string,
): Promise<void> {
  const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || "http://localhost:3003";
  const BROWSER_AGENT_KEY = process.env.BROWSER_AGENT_API_KEY || "";

  try {
    const res = await fetch(`${BROWSER_AGENT_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": BROWSER_AGENT_KEY },
      body: JSON.stringify({
        site: storeUrl,
        action: `Navigate to ${storeUrl}. Check if the site has a login/account system and if it supports guest checkout. Return JSON: { requiresAuth: boolean, hasGuestCheckout: boolean }`,
        priority: 3,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.warn(`[STORE CHECK] Browser agent returned ${res.status} for ${storeUrl}`);
      return;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const taskId = data.task_id as string;
    if (!taskId) return;

    // Poll for result (max 60s)
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const check = await fetch(`${BROWSER_AGENT_URL}/tasks/${taskId}`, {
        headers: { "x-api-key": BROWSER_AGENT_KEY },
        signal: AbortSignal.timeout(5000),
      });
      if (!check.ok) continue;
      const task = (await check.json()) as Record<string, unknown>;
      if (task.status === "completed") {
        const result = task.result as Record<string, unknown> | undefined;
        const requiresAuth = !!(result?.requiresAuth);
        const hasGuestCheckout = !!(result?.hasGuestCheckout);

        // Save to store_connections
        await prisma.$executeRaw`
          INSERT INTO store_connections (id, user_id, store_url, store_name, requires_auth, has_guest_checkout, last_checked_at, status)
          VALUES (gen_random_uuid()::text, ${userId}, ${storeUrl}, ${storeLabel}, ${requiresAuth}, ${hasGuestCheckout}, NOW(), 'checked')
          ON CONFLICT (id) DO NOTHING
        `;

        console.log(`[STORE CHECK] ${storeLabel}: requiresAuth=${requiresAuth}, guestCheckout=${hasGuestCheckout}`);
        return;
      }
      if (task.status === "failed") {
        console.warn(`[STORE CHECK] Browser agent failed for ${storeUrl}`);
        return;
      }
    }
  } catch (err) {
    console.warn(`[STORE CHECK] Error checking ${storeUrl}:`, (err as Error).message);
  }
}

async function connectStore(
  userId: string,
  store: string,
  storeUrl: string,
  storeLabel: string,
  requiresAuth: boolean
): Promise<void> {
  const existing = await prisma.storeContext.findUnique({
    where: { userId_store: { userId, store } },
  });
  if (existing) return;

  await prisma.storeContext.create({
    data: {
      userId,
      store,
      storeUrl,
      storeLabel,
      status: "configured",
    },
  });
}

async function moveToKycStep(
  sessionId: string,
  prefix: string,
  lang?: Lang,
): Promise<BotResponse> {
  const effectiveLang = lang ?? await getSessionLang(sessionId);

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "kyc_info" },
  });

  return {
    message: (t("kycPrompt", effectiveLang) as (p: string) => string)(prefix),
    step: "kyc_info",
    complete: false,
  };
}

async function moveToShippingStep(
  sessionId: string,
  prefix: string,
  lang?: Lang,
): Promise<BotResponse> {
  const effectiveLang = lang ?? await getSessionLang(sessionId);

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "shipping_address" },
  });

  return {
    message: (t("shippingPrompt", effectiveLang) as (p: string) => string)(prefix),
    step: "shipping_address",
    complete: false,
  };
}

// ─── Step: kyc_info (country) ──────────────────────────────

async function handleKycCountryStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.userId) return { message: "Internal error.", step: "error", complete: false };

  if (lower === "skip" || lower === "pular" || lower === "saltar") {
    return moveToShippingStep(sessionId, "", lang);
  }

  let country: string | null = null;
  if (lower === "1" || lower === "us" || lower.includes("united") || lower.includes("estados unidos") || lower.includes("eua")) {
    country = "US";
  } else if (lower === "2" || lower === "br" || lower.includes("brazil") || lower.includes("brasil")) {
    country = "BR";
  }

  if (!country) {
    return {
      message: (t("kycPrompt", lang) as (p: string) => string)("I didn't understand. "),
      step: "kyc_info",
      complete: false,
    };
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: { country },
  });

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "kyc_dob" },
  });

  return {
    message: (t("kycDobPrompt", lang) as (c: string) => string)(country === "US" ? "United States" : "Brasil"),
    step: "kyc_dob",
    complete: false,
  };
}

// ─── Step: kyc_dob ──────────────────────────────────────────

function parseDateOfBirth(input: string, lang: Lang): Date | null {
  const cleaned = input.trim().replace(/[\/\-\.]/g, "/");
  const parts = cleaned.split("/");
  if (parts.length !== 3) return null;

  let day: number, month: number, year: number;

  if (lang === "en") {
    // MM/DD/YYYY
    month = parseInt(parts[0]);
    day = parseInt(parts[1]);
    year = parseInt(parts[2]);
  } else {
    // DD/MM/YYYY for PT and ES
    day = parseInt(parts[0]);
    month = parseInt(parts[1]);
    year = parseInt(parts[2]);
  }

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (year < 100) year += 1900;
  if (year < 1900 || year > 2010) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

async function handleKycDobStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.userId) return { message: "Internal error.", step: "error", complete: false };

  if (lower === "skip" || lower === "pular" || lower === "saltar") {
    return moveToKycDocOrShipping(sessionId, session.userId, lang);
  }

  const dob = parseDateOfBirth(input, lang);
  if (!dob) {
    return { message: t("kycDobInvalid", lang) as string, step: "kyc_dob", complete: false };
  }

  const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age < 18) {
    return { message: t("kycTooYoung", lang) as string, step: "kyc_dob", complete: false };
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: { dateOfBirth: dob },
  });

  return moveToKycDocOrShipping(sessionId, session.userId, lang);
}

async function moveToKycDocOrShipping(sessionId: string, userId: string, lang: Lang): Promise<BotResponse> {
  // Check if country is BR — if so, ask for CPF. Otherwise skip doc step.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { country: true } });

  if (user?.country === "BR") {
    await prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { step: "kyc_doc" },
    });
    return {
      message: t("kycDocPrompt", lang) as string,
      step: "kyc_doc",
      complete: false,
    };
  }

  // For US or unknown, skip doc and go to shipping
  // Auto-upgrade to BASIC if we have enough data
  await autoUpgradeKyc(userId);
  const prefix = t("kycComplete", lang) as string;
  return moveToShippingStep(sessionId, prefix, lang);
}

// ─── Step: kyc_doc (CPF / document) ─────────────────────────

function validateCpfOnboarding(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  if (parseInt(digits[9]) !== check) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  return parseInt(digits[10]) === check;
}

async function handleKycDocStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.userId) return { message: "Internal error.", step: "error", complete: false };

  if (lower === "skip" || lower === "pular" || lower === "saltar") {
    await autoUpgradeKyc(session.userId);
    const prefix = t("kycComplete", lang) as string;
    return moveToShippingStep(sessionId, prefix, lang);
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { country: true } });

  if (user?.country === "BR") {
    if (!validateCpfOnboarding(input.trim())) {
      return { message: t("kycDocInvalid", lang) as string, step: "kyc_doc", complete: false };
    }
  }

  const docNumber = input.trim().replace(/\D/g, "");
  await prisma.user.update({
    where: { id: session.userId },
    data: { documentNumber: docNumber },
  });

  await autoUpgradeKyc(session.userId);
  const prefix = t("kycComplete", lang) as string;
  return moveToShippingStep(sessionId, prefix, lang);
}

async function autoUpgradeKyc(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, dateOfBirth: true, country: true, kycLevel: true },
  });
  if (!user || user.kycLevel !== "NONE") return;

  const hasName = user.fullName && user.fullName !== "SnifferShop User";
  const hasDob = !!user.dateOfBirth;
  const hasCountry = !!user.country;

  if (hasName && hasDob && hasCountry) {
    await prisma.user.update({
      where: { id: userId },
      data: { kycLevel: "BASIC", kycSubmittedAt: new Date(), status: "ACTIVE" },
    });
  }
}

// ─── Step: shipping_address ─────────────────────────────

async function handleShippingAddressStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.userId) return { message: "Internal error.", step: "error", complete: false };

  if (lower === "skip" || lower === "pular" || lower === "saltar") {
    return moveToPaymentStep(sessionId, session.userId, lang);
  }

  const address = input.trim();
  if (address.length < 10) {
    return {
      message: t("shippingTooShort", lang) as string,
      step: "shipping_address",
      complete: false,
    };
  }

  // Save as legacy text
  await prisma.user.update({
    where: { id: session.userId },
    data: { shippingAddress: address },
  });

  // Try to parse and create structured UserAddress
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { fullName: true, country: true, phone: true },
    });
    const parsed = parseAddressText(address, (user?.country as "US" | "BR") || "US");
    if (parsed) {
      // Remove any existing default shipping address
      await prisma.userAddress.updateMany({
        where: { userId: session.userId, isDefault: true },
        data: { isDefault: false },
      });
      await prisma.userAddress.create({
        data: {
          userId: session.userId,
          label: "Home",
          type: "SHIPPING",
          country: parsed.country,
          isDefault: true,
          fullName: user?.fullName || "User",
          phone: user?.phone,
          street: parsed.street,
          complement: parsed.complement,
          city: parsed.city,
          state: parsed.state,
          postalCode: parsed.postalCode,
          neighborhood: parsed.neighborhood,
        },
      });
    }
  } catch (err) {
    // Non-blocking — legacy text is already saved
    console.warn("[Onboarding] Could not parse structured address:", (err as Error).message);
  }

  const prefix = (t("shippingConfirm", lang) as (addr: string) => string)(address);
  return moveToPaymentStep(sessionId, session.userId, lang, prefix);
}

/**
 * Best-effort parser for free-text addresses into structured fields.
 * Handles common US and BR formats.
 */
function parseAddressText(text: string, defaultCountry: "US" | "BR"): {
  street: string; complement?: string; city: string; state: string;
  postalCode: string; neighborhood?: string; country: "US" | "BR";
} | null {
  // Try US format: "123 Main St, Miami, FL 33101"
  const usMatch = text.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (usMatch) {
    return {
      street: usMatch[1].trim(),
      city: usMatch[2].trim(),
      state: usMatch[3].toUpperCase(),
      postalCode: usMatch[4],
      country: "US",
    };
  }

  // Try BR format: "Rua X 123, Bairro, Cidade, SP, 01000000" or "Rua X 123, Bairro, Cidade, SP 01000-000"
  const brMatch = text.match(/^(.+?),\s*(.+?),\s*(.+?),\s*([A-Z]{2}),?\s*(\d{5}-?\d{3}|\d{8})$/i);
  if (brMatch) {
    return {
      street: brMatch[1].trim(),
      neighborhood: brMatch[2].trim(),
      city: brMatch[3].trim(),
      state: brMatch[4].toUpperCase(),
      postalCode: brMatch[5].replace("-", ""),
      country: "BR",
    };
  }

  return null;
}

async function moveToPaymentStep(
  sessionId: string,
  userId: string,
  lang: Lang,
  prefix = ""
): Promise<BotResponse> {
  let paymentMessage = "";
  try {
    const link = await generateStripeSetupLink(userId, sessionId);
    paymentMessage = (t("paymentPrompt", lang) as (l: string) => string)(link);
  } catch {
    paymentMessage = t("paymentFallback", lang) as string;
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "payment" },
  });

  return {
    message: `${prefix}${paymentMessage}`,
    step: "payment",
    complete: false,
  };
}

// ─── Step: payment ───────────────────────────────────────

async function handlePaymentStep(sessionId: string, input: string, lang: Lang): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();

  if (lower === "skip" || lower === "pular" || lower === "saltar") {
    return completeOnboarding(sessionId, lang);
  }

  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Session not found.", step: "error", complete: false };

  if (session.paymentSetup) {
    return completeOnboarding(sessionId, lang);
  }

  if (lower === "done" || lower === "pronto" || lower === "listo" || lower === "ok" || lower === "✅") {
    if (session.stripeSetupIntent) {
      try {
        const provider = getPaymentProvider("stripe") as StripeProvider;
        const { paymentMethodId } = await provider.getSetupIntentPaymentMethod(session.stripeSetupIntent);
        if (paymentMethodId) {
          await prisma.onboardingSession.update({
            where: { id: sessionId },
            data: { paymentSetup: true },
          });
          return completeOnboarding(sessionId, lang);
        }
      } catch {
        // Setup intent not completed yet
      }
    }

    return {
      message: t("paymentNotDetected", lang) as string,
      step: "payment",
      complete: false,
    };
  }

  return {
    message: t("paymentClickLink", lang) as string,
    step: "payment",
    complete: false,
  };
}

// ─── Complete ────────────────────────────────────────────

export async function completeOnboarding(sessionId: string, lang?: Lang): Promise<BotResponse> {
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Session not found.", step: "error", complete: false };

  const effectiveLang = lang ?? (session.language as Lang) ?? "en";
  const nickname = session.botNickname || "Sniffer";

  if (session.userId) {
    await prisma.$transaction(async (tx) => {
      await tx.onboardingSession.update({
        where: { id: sessionId },
        data: { step: "complete" },
      });

      await tx.user.update({
        where: { id: session.userId! },
        data: { onboardingCompleted: true, onboardingStep: 5, botNickname: nickname },
      });

      const existingCredit = await tx.llmCredit.findUnique({ where: { userId: session.userId! } });
      if (!existingCredit) {
        await tx.llmCredit.create({
          data: {
            userId: session.userId!,
            messagesTotal: 5000,
            messagesUsed: 0,
            messagesRemaining: 5000,
            freeTrialActive: false,
            freeTrialEndsAt: null,
          },
        });
        console.log(`[Credit] Initialized for ${session.userId} (beta user) [via transaction]`);
      }
    });

    // Seed user facts so AI remembers onboarding data
    const platform = session.telegramChatId ? "telegram" : "whatsapp";
    const chatId = session.telegramChatId ?? session.whatsappPhone ?? "";

    if (chatId) {
      seedUserFacts(chatId, session, effectiveLang).catch((err) => {
        console.error(`[Onboarding] seedUserFacts error for ${chatId}:`, (err as Error).message);
      });
    }

    // Sequence init with retry
    const referrerName = session.shareCode ? await getSharedByName(session.shareCode) : null;

    if (chatId) {
      withRetry(
        () => initSequence(session.userId!, platform, chatId, referrerName ?? undefined),
        `initSequence(${session.userId})`,
      ).catch((err) => {
        console.error(`[Onboarding] CRITICAL: initSequence permanently failed for ${session.userId}:`, (err as Error).message);
      });
    }
  } else {
    await prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { step: "complete" },
    });
  }

  // Notify referrer
  if (session.shareCode) {
    notifyReferrer(session.shareCode, session.fullName ?? session.email ?? "Someone").catch(() => {});
  }

  return {
    message: (t("complete", effectiveLang) as (n: string) => string)(nickname),
    step: "complete",
    complete: true,
  };
}

// ─── Stripe Setup ────────────────────────────────────────

export async function generateStripeSetupLink(userId: string, sessionId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const provider = getPaymentProvider("stripe") as StripeProvider;
  if (!provider.isAvailable) throw new Error("Stripe not configured");

  const customerId = await provider.getOrCreateCustomer({
    userId: user.id,
    email: user.email,
    name: user.fullName ?? undefined,
    existingCustomerId: user.stripeCustomerId,
  });

  if (customerId !== user.stripeCustomerId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const result = await provider.createSetupIntent({
    customerId,
    userId: user.id,
    metadata: { onboardingSessionId: sessionId },
  });

  const baseUrl = process.env.WEB_URL || "https://www.payjarvis.com";
  const link = `${baseUrl}/setup-payment?intent=${result.setupIntentId}&session=${sessionId}&secret=${result.clientSecret}`;

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: {
      stripeSetupIntent: result.setupIntentId,
      stripePaymentLink: link,
    },
  });

  return link;
}

// ─── Seed user facts from onboarding data ────────────────

async function seedUserFacts(
  chatId: string,
  session: { fullName?: string | null; botNickname?: string | null; email?: string | null },
  lang: Lang,
) {
  const langCode = lang === "pt" ? "pt-BR" : lang === "es" ? "es-ES" : "en-US";
  const facts: [string, string, string][] = [];

  if (session.fullName) {
    facts.push(["user_name", session.fullName, "identity"]);
    const firstName = session.fullName.split(" ")[0];
    if (firstName) facts.push(["first_name", firstName, "identity"]);
  }
  if (session.botNickname) {
    facts.push(["bot_nickname", session.botNickname, "identity"]);
  }
  if (session.email) {
    facts.push(["email", session.email, "identity"]);
  }
  facts.push(["language", langCode, "preferences"]);

  for (const [key, value, category] of facts) {
    await prisma.$executeRaw`
      INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, updated_at)
      VALUES (${chatId}, ${key}, ${value}, ${category}, ${"onboarding"}, now())
      ON CONFLICT (user_id, fact_key) DO UPDATE SET
        fact_value = ${value}, category = ${category}, source = ${"onboarding"}, updated_at = now()
    `;
  }

  console.log(`[Onboarding] Seeded ${facts.length} user facts for ${chatId} (lang: ${langCode})`);
}

// ─── Session check ───────────────────────────────────────

export async function hasActiveSession(chatId: string, platform: string): Promise<boolean> {
  const session = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (!session) return false;
  return session.step !== "complete" && session.expiresAt > new Date();
}

// ─── User + Bot creation ─────────────────────────────────

async function createUserAndBot(session: {
  id: string;
  email: string | null;
  fullName: string | null;
  botNickname: string | null;
  shareCode: string | null;
  telegramChatId: string | null;
  whatsappPhone: string | null;
}): Promise<{ userId: string; botId: string }> {
  if (!session.email) throw new Error("Email is required");

  let user = await prisma.user.findUnique({ where: { email: session.email } });

  if (!user) {
    const clerkId = `bot_onboard_${randomBytes(12).toString("hex")}`;
    user = await prisma.user.create({
      data: {
        clerkId,
        email: session.email,
        fullName: session.fullName || session.email.split("@")[0],
        kycLevel: "NONE",
        status: "PENDING_KYC",
        onboardingStep: 2,
        telegramChatId: session.telegramChatId ?? undefined,
        phone: session.whatsappPhone?.replace("whatsapp:", "") ?? undefined,
        notificationChannel: session.telegramChatId ? "telegram" : session.whatsappPhone ? "whatsapp" : "none",
        botNickname: session.botNickname ?? "Sniffer",
      },
    });
  } else {
    const updates: Record<string, unknown> = {};
    if (session.telegramChatId && !user.telegramChatId) {
      updates.telegramChatId = session.telegramChatId;
      updates.notificationChannel = "telegram";
    }
    if (session.botNickname) {
      updates.botNickname = session.botNickname;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: updates });
    }
  }

  const botName = session.botNickname || "Sniffer";

  let botId: string;
  if (session.shareCode) {
    const link = await prisma.botShareLink.findUnique({ where: { code: session.shareCode } });
    if (link) {
      const config = link.templateConfig as Record<string, unknown>;
      const rawKey = `pj_bot_${randomBytes(24).toString("hex")}`;
      const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");

      const bot = await prisma.bot.create({
        data: {
          ownerId: user.id,
          name: botName,
          platform: (config.platform as any) ?? "TELEGRAM",
          apiKeyHash,
          systemPrompt: (config.systemPrompt as string) ?? null,
          botDisplayName: botName,
          capabilities: (config.capabilities as string[]) ?? [],
          language: (config.language as string) ?? "en",
        },
      });

      const policyConfig = config.policy as Record<string, unknown> | null;
      await prisma.policy.create({
        data: {
          botId: bot.id,
          maxPerTransaction: (policyConfig?.maxPerTransaction as number) ?? 100,
          maxPerDay: (policyConfig?.maxPerDay as number) ?? 500,
          autoApproveLimit: (policyConfig?.autoApproveLimit as number) ?? 50,
          allowedCategories: (policyConfig?.allowedCategories as string[]) ?? [],
          timezone: (policyConfig?.timezone as string) ?? "America/New_York",
        },
      });

      const agentId = `ag_${randomBytes(12).toString("hex")}`;
      await prisma.agent.create({
        data: { id: agentId, botId: bot.id, ownerId: user.id, name: `Agent for ${botName}` },
      });

      await prisma.botShareLink.update({
        where: { code: session.shareCode },
        data: { useCount: { increment: 1 } },
      });
      await prisma.botClone.create({
        data: {
          shareCode: session.shareCode,
          newBotId: bot.id,
          newUserId: user.id,
          referredByUserId: link.createdByUserId,
        },
      });

      botId = bot.id;
    } else {
      botId = await createDefaultBot(user.id, botName);
    }
  } else {
    botId = await createDefaultBot(user.id, botName);
  }

  return { userId: user.id, botId };
}

async function createDefaultBot(userId: string, botName = "Sniffer"): Promise<string> {
  const rawKey = `pj_bot_${randomBytes(24).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");

  const bot = await prisma.bot.create({
    data: {
      ownerId: userId,
      name: botName,
      platform: "TELEGRAM",
      apiKeyHash,
      botDisplayName: botName,
      capabilities: ["amazon", "walmart", "target"],
      language: "en",
    },
  });

  await prisma.policy.create({
    data: {
      botId: bot.id,
      maxPerTransaction: 100,
      maxPerDay: 500,
      autoApproveLimit: 50,
    },
  });

  const agentId = `ag_${randomBytes(12).toString("hex")}`;
  await prisma.agent.create({
    data: { id: agentId, botId: bot.id, ownerId: userId, name: `Agent for ${botName}` },
  });

  return bot.id;
}

// ─── Step message (resume) ───────────────────────────────

async function getStepMessage(step: string, session: { email?: string | null; fullName?: string | null }, lang: Lang): Promise<string> {
  switch (step) {
    case "name":
      return t("resumeName", lang) as string;
    case "bot_nickname":
      return (t("resumeNickname", lang) as (n: string) => string)(session.fullName ?? "Hey");
    case "email_password":
      return t("resumeEmailPassword", lang) as string;
    case "email_confirm":
      return (t("resumeEmailConfirm", lang) as (e: string) => string)(session.email ?? "your email");
    case "beta_choice":
      return t("resumeBetaChoice", lang) as string;
    case "limits":
      return t("resumeLimits", lang) as string;
    case "stores":
      return t("resumeStores", lang) as string;
    case "kyc_info":
    case "kyc_dob":
    case "kyc_doc":
      return t("resumeKyc", lang) as string;
    case "shipping_address":
      return t("resumeShipping", lang) as string;
    case "payment":
      return t("resumePayment", lang) as string;
    default:
      return t("resumeDefault", lang) as string;
  }
}

// ─── Notify referrer ─────────────────────────────────────

async function notifyReferrer(shareCode: string, newUserName: string): Promise<void> {
  const link = await prisma.botShareLink.findUnique({
    where: { code: shareCode },
    select: { createdByUserId: true },
  });
  if (!link) return;

  const referrer = await prisma.user.findUnique({
    where: { id: link.createdByUserId },
    select: { telegramChatId: true, phone: true, notificationChannel: true },
  });

  const text = `🎉 ${newUserName} activated the bot you shared!`;

  // Notify via Telegram
  if (referrer?.telegramChatId) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: referrer.telegramChatId, text }),
        });
      } catch (err) {
        console.error("[Onboarding] Failed to notify referrer via Telegram:", err);
      }
    }
  }

  // Notify via WhatsApp
  if (referrer?.phone && referrer.notificationChannel === "whatsapp") {
    try {
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
      if (twilioSid && twilioToken && fromNumber) {
        const toNumber = `whatsapp:${referrer.phone.startsWith("+") ? referrer.phone : "+" + referrer.phone}`;
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}`,
          },
          body: new URLSearchParams({ From: fromNumber, To: toNumber, Body: text }).toString(),
        });
      }
    } catch (err) {
      console.error("[Onboarding] Failed to notify referrer via WhatsApp:", err);
    }
  }
}

// ─── Quick Start — friction-free onboarding (name only) ──

/**
 * Create a user account instantly with just a name + chatId.
 * No email, no KYC, no password required.
 * User can start chatting immediately.
 * Email/KYC/payment collected later via drip sequence.
 */
export async function quickStart(opts: {
  name: string;
  telegramChatId?: string;
  whatsappPhone?: string;
  language?: string;
  shareCode?: string;
  referrerUserId?: string;
}): Promise<{ userId: string; botId: string; isNew: boolean }> {
  // Check if user already exists
  if (opts.telegramChatId) {
    const existing = await prisma.user.findFirst({ where: { telegramChatId: opts.telegramChatId } });
    if (existing) {
      const bot = await prisma.bot.findFirst({ where: { ownerId: existing.id } });
      return { userId: existing.id, botId: bot?.id ?? "", isNew: false };
    }
  }
  if (opts.whatsappPhone) {
    const cleaned = opts.whatsappPhone.replace("whatsapp:", "");
    const existing = await prisma.user.findFirst({ where: { phone: cleaned } });
    if (existing) {
      const bot = await prisma.bot.findFirst({ where: { ownerId: existing.id } });
      return { userId: existing.id, botId: bot?.id ?? "", isNew: false };
    }
  }

  // Generate synthetic email (user can update later)
  const slug = opts.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  const rand = randomBytes(3).toString("hex");
  const syntheticEmail = `${slug}.${rand}@bot.payjarvis.io`;
  const clerkId = `quick_${randomBytes(12).toString("hex")}`;

  const user = await prisma.user.create({
    data: {
      clerkId,
      email: syntheticEmail,
      fullName: opts.name,
      kycLevel: "NONE",
      status: "ACTIVE",
      onboardingStep: 5,
      onboardingCompleted: true,
      telegramChatId: opts.telegramChatId ?? undefined,
      phone: opts.whatsappPhone?.replace("whatsapp:", "") ?? undefined,
      notificationChannel: opts.telegramChatId ? "telegram" : opts.whatsappPhone ? "whatsapp" : "none",
      botNickname: "Sniffer",
      referredByUserId: opts.referrerUserId ?? undefined,
    },
  });

  // Create default bot + policy + agent
  const botId = await createDefaultBot(user.id, "Sniffer");

  // Init credits (5000 free messages)
  await initCredits(user.id, opts.referrerUserId).catch((err) => {
    console.error(`[QuickStart] initCredits error: ${(err as Error).message}`);
  });

  // Init drip sequence (async, non-blocking)
  const platform = opts.telegramChatId ? "telegram" : "whatsapp";
  const chatId = opts.telegramChatId ?? opts.whatsappPhone ?? "";
  if (chatId) {
    initSequence(user.id, platform, chatId).catch((err) => {
      console.error(`[QuickStart] initSequence error: ${(err as Error).message}`);
    });
  }

  // Seed basic facts
  if (chatId) {
    const factId = opts.telegramChatId ?? opts.whatsappPhone ?? "";
    try {
      await prisma.$executeRaw`
        INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, confidence)
        VALUES (${factId}, 'name', ${opts.name}, 'personal', 'quick_start', 0.95)
        ON CONFLICT (user_id, fact_key) DO UPDATE SET fact_value = ${opts.name}
      `;
      if (opts.language) {
        await prisma.$executeRaw`
          INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, confidence)
          VALUES (${factId}, 'language', ${opts.language}, 'personal', 'quick_start', 0.9)
          ON CONFLICT (user_id, fact_key) DO UPDATE SET fact_value = ${opts.language}
        `;
      }
    } catch { /* non-critical */ }
  }

  // Process referral if applicable
  if (opts.referrerUserId) {
    try {
      const { processReferral } = await import("./trial.service.js");
      await processReferral(opts.referrerUserId, user.id);
    } catch { /* non-critical */ }
  }

  console.log(`[QuickStart] Created user ${user.id} (${opts.name}) via ${platform}`);
  return { userId: user.id, botId, isNew: true };
}
