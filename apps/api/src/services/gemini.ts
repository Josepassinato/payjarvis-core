import { GoogleGenerativeAI, SchemaType, type FunctionDeclarationSchema } from "@google/generative-ai";
import { prisma } from "@payjarvis/database";

function buildDefaultPrompt(ownerName: string, botName: string, capabilities: string[], language: string, amazonDomain?: string): string {
  const capList = capabilities.length > 0
    ? `\n\nYour capabilities:\n${capabilities.map(c => `- ${c}`).join("\n")}`
    : "";

  return `You are ${botName}, a personal assistant for ${ownerName}.

You are intelligent, proactive, and discreet. You respond in ${language}.${capList}

CORE RULE — SELF-AWARENESS
Before responding, check your available tools. NEVER say "I can't" or "I don't know" when you have a tool that helps.
YOUR TOOLS: amazon_search, search_products (Amazon/Walmart/Google Shopping — use platform='all' to compare prices), generate_document, export_transactions, setup_vault, save_card, list_vault_items, delete_vault_item, save_store_credentials, remove_store_credentials, share_bot, skyfire_setup_wallet, skyfire_checkout, skyfire_my_purchases, skyfire_spending, skyfire_set_limits, manage_payment_methods, smart_checkout.
PAYMENT WALLET: When user wants to buy something, use smart_checkout — it checks the user's payment wallet and shows available options. When user asks about payment methods ("how can I pay?", "add PayPal", "my payment methods"), use manage_payment_methods. NEVER hardcode a payment method — always check the wallet first.
If user sends an image → ANALYZE IT (you have vision). If user asks to buy → search_products. If user wants a document → generate_document.
SHOPPING: Present results as PRICE RANKING (cheapest first). Show rank, product name, price, rating, link. Highlight BEST VALUE.
NEVER give up. If one approach fails, try another. Always offer alternatives.

PERSONALITY — You are NOT a generic AI. You have a REAL personality:
- WARM but not fake — genuinely care about the user
- FUNNY when appropriate — use humor naturally, not forced
- OPINIONATED — "Honestly, I think the Walmart deal is better because..."
- REMEMBERS things — "Last time you looked for sneakers, you liked Nike. Want me to check?"
- CASUAL — talk like a friend, not a robot
- PROACTIVE — suggest things without being asked
- CELEBRATES wins — "Nice! You saved $50 on that purchase! 🎉"
- HONEST — "That's overpriced. I found it $30 cheaper here."
- HAS CATCHPHRASES — uses 🦀 emoji, says "Leave it to me!" or "On it!"
- Direct and concise — no fluff
${amazonDomain ? `\n\nWhen searching or linking to Amazon products, ALWAYS use https://www.${amazonDomain}. Never use a different Amazon domain unless the user explicitly requests it.` : ""}

When the user provides login credentials (email and password) for any store or service, use the save_store_credentials function to save them securely. NEVER repeat the password in your response — only confirm the email and store name.

When the user asks to remove or delete their login for a store, use the remove_store_credentials function.

SECURITY & VAULT — You have access to a Zero-Knowledge encrypted vault for each user.
When the user wants to save sensitive data (credit cards, passwords, credentials), ALWAYS use the vault tools (setup_vault, save_card).
NEVER store card numbers, CVVs, or passwords in plain text in the conversation history.
After the user provides card details, save them to the vault and inform that the message will be removed from history.
Always explain that the data is encrypted with THEIR personal PIN and that not even the PayJarvis team can access it.
When making a purchase that requires card details, ask for the PIN first, retrieve the card, use it, and clear from memory.
If the user hasn't set up their vault yet, guide them to create a PIN first using setup_vault.

Sign off as: ${botName}`;
}

const MAX_HISTORY = 25;
const MAX_RESPONSE_LENGTH = 4000;

interface HistoryEntry {
  role: "user" | "model";
  parts: { text: string }[];
}

// DB-backed history for custom bots (survives restarts)
async function getDbHistory(botId: string, chatId: string): Promise<HistoryEntry[]> {
  const key = `bot:${botId}:${chatId}`;
  const rows = await prisma.$queryRaw<{ role: string; content: string }[]>`
    SELECT role, content FROM openclaw_conversations
    WHERE user_id = ${key} ORDER BY created_at DESC LIMIT ${MAX_HISTORY * 2}
  `;
  const raw = rows.reverse().map(r => ({
    role: r.role as "user" | "model",
    parts: [{ text: r.content }],
  }));
  // Merge consecutive same-role and ensure alternating
  const history: HistoryEntry[] = [];
  for (const entry of raw) {
    if (history.length > 0 && history[history.length - 1].role === entry.role) {
      history[history.length - 1].parts[0].text += "\n" + entry.parts[0].text;
    } else {
      history.push(entry);
    }
  }
  while (history.length > 0 && history[0].role !== "user") history.shift();
  while (history.length > 0 && history[history.length - 1].role !== "model") history.pop();
  return history;
}

async function saveDbMessage(botId: string, chatId: string, role: string, content: string) {
  const key = `bot:${botId}:${chatId}`;
  await prisma.$executeRaw`
    INSERT INTO openclaw_conversations (user_id, role, content) VALUES (${key}, ${role}, ${content})
  `;
}

export interface ChatContext {
  botId: string;
  ownerName?: string;
  botName?: string;
  systemPrompt?: string;
  capabilities?: string[];
  language?: string;
  amazonDomain?: string;
}

export interface GeminiResult {
  text: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}

const saveCredentialsParams: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    store_name: { type: SchemaType.STRING, description: "Store name (e.g. Amazon, Macy's, Walmart, Target)" },
    email: { type: SchemaType.STRING, description: "Login email or username" },
    password: { type: SchemaType.STRING, description: "Login password" },
  },
  required: ["store_name", "email", "password"],
};

const removeCredentialsParams: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    store_name: { type: SchemaType.STRING, description: "Store name to remove credentials for" },
  },
  required: ["store_name"],
};

const amazonSearchParams: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    query: { type: SchemaType.STRING, description: "Search query for Amazon products (e.g. 'iPhone 17 charger cable 6ft')" },
    max_results: { type: SchemaType.NUMBER, description: "Max products to return (default 3, max 5)" },
  },
  required: ["query"],
};

const shareBotParams: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    platform: { type: SchemaType.STRING, description: "Platform: 'telegram' or 'whatsapp'. Ask the user if not clear." },
  },
  required: ["platform"],
};

const credentialTools = [{
  functionDeclarations: [
    {
      name: "save_store_credentials",
      description: "Save store login credentials to the user's secure vault. Call this when the user provides their email/username and password for a store.",
      parameters: saveCredentialsParams,
    },
    {
      name: "remove_store_credentials",
      description: "Remove stored login credentials for a store from the user's vault. Call this when the user asks to delete or remove their login for a store.",
      parameters: removeCredentialsParams,
    },
    {
      name: "amazon_search",
      description: "Search for products on Amazon. Use this when the user wants to buy something, find a product, compare prices, or asks about items on Amazon. Returns real product data with prices and direct purchase links.",
      parameters: amazonSearchParams,
    },
    {
      name: "share_bot",
      description: "Generate a referral/share link and QR code so the user can invite friends. Use when the user says: indicar, compartilhar, share, invite, convidar, QR code, link para amigo, referral. The friend gets free Beta access.",
      parameters: shareBotParams,
    },
    {
      name: "generate_document",
      description: "Generate a PDF document (contract, letter, report, resume, proposal, invoice, receipt, or any document) and send it to the user. Use when the user asks to write, create, draft, or generate any document.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING, description: "Document title" },
          content: { type: SchemaType.STRING, description: "Full document content in Markdown. Use ## for headings, **bold** for emphasis, - for lists. Write the COMPLETE document, not a summary." },
          type: { type: SchemaType.STRING, description: "Type: contract, letter, report, resume, proposal, invoice, receipt, general" },
        },
        required: ["title", "content"],
      } as FunctionDeclarationSchema,
    },
    {
      name: "export_transactions",
      description: "Export the user's transaction statement as PDF. Use when the user asks for a statement, purchase history, spending report, or transaction export.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          period: { type: SchemaType.STRING, description: "Period: last_week, last_month, last_3months, all" },
        },
        required: [],
      } as FunctionDeclarationSchema,
    },
    {
      name: "setup_vault",
      description: "Configure the user's Zero-Knowledge secure vault with a PIN. Use when the user wants to save sensitive data like credit cards or credentials for the first time and hasn't set up their vault yet.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          pin: { type: SchemaType.STRING, description: "PIN of 4-32 characters chosen by the user" },
        },
        required: ["pin"],
      } as FunctionDeclarationSchema,
    },
    {
      name: "save_card",
      description: "Save a credit/debit card to the user's Zero-Knowledge encrypted vault. Use when the user wants to add a card for purchases. Requires vault to be set up first.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          pin: { type: SchemaType.STRING, description: "User's vault PIN" },
          card_number: { type: SchemaType.STRING, description: "Card number" },
          expiry: { type: SchemaType.STRING, description: "Expiry date MM/YY" },
          cvv: { type: SchemaType.STRING, description: "CVV code" },
          cardholder_name: { type: SchemaType.STRING, description: "Name on card" },
          label: { type: SchemaType.STRING, description: "Nickname: 'Personal Visa', 'Work Mastercard'" },
        },
        required: ["pin", "card_number", "expiry", "cvv", "cardholder_name"],
      } as FunctionDeclarationSchema,
    },
    {
      name: "list_vault_items",
      description: "List items saved in the user's secure vault (cards, credentials) WITHOUT showing sensitive data. Use when the user asks what's in their vault.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
      } as FunctionDeclarationSchema,
    },
    {
      name: "delete_vault_item",
      description: "Remove an item from the user's secure vault.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          item_id: { type: SchemaType.STRING, description: "ID of the item to remove" },
        },
        required: ["item_id"],
      } as FunctionDeclarationSchema,
    },
    {
      name: "manage_payment_methods",
      description: "Manage the user's Payment Wallet. Use when the user asks about payment methods, wants to add/remove a method, or set a default. Actions: list (show all methods), add (register new method), remove (delete a method), set_default (mark as preferred).",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          action: { type: SchemaType.STRING, description: "Action: list, add, remove, set_default" },
          provider: { type: SchemaType.STRING, description: "For add: paypal, stripe, amazon, pix, credit_card. For remove/set_default: the method ID." },
          display_name: { type: SchemaType.STRING, description: "For add: display name like 'PayPal (jose@gmail.com)' or 'Visa ••••4242'" },
          method_id: { type: SchemaType.STRING, description: "For remove or set_default: the payment method ID" },
          email: { type: SchemaType.STRING, description: "For PayPal: the PayPal email address" },
          metadata: { type: SchemaType.STRING, description: "JSON string with extra metadata (e.g. pix key, card last4)" },
        },
        required: ["action"],
      } as FunctionDeclarationSchema,
    },
    {
      name: "smart_checkout",
      description: "Start a smart purchase. Checks the user's Payment Wallet and shows available payment options for the given product/amount. Use INSTEAD of skyfire_checkout when the user confirms they want to buy something. This tool returns the options — the user then picks one.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          product_name: { type: SchemaType.STRING, description: "Product name" },
          product_url: { type: SchemaType.STRING, description: "Product URL (if available)" },
          amount: { type: SchemaType.NUMBER, description: "Price amount" },
          currency: { type: SchemaType.STRING, description: "Currency code: USD, BRL, EUR" },
          store: { type: SchemaType.STRING, description: "Store name: amazon, walmart, etc. (optional)" },
        },
        required: ["product_name", "amount"],
      } as FunctionDeclarationSchema,
    },
  ],
}];

export async function chatWithGemini(chatId: string, userMessage: string, ctx: ChatContext): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: "Assistant unavailable. Visit https://www.payjarvis.com" };
  }

  const ownerName = ctx.ownerName || "the user";
  const botName = ctx.botName || "Assistant";
  const capabilities = ctx.capabilities || [];
  const language = ctx.language || "en";
  const amazonDomain = ctx.amazonDomain;

  // Use custom system prompt if provided, otherwise build default
  let systemPrompt: string;
  if (ctx.systemPrompt) {
    systemPrompt = ctx.systemPrompt;
    if (amazonDomain) {
      systemPrompt += `\n\nWhen searching or linking to Amazon products, ALWAYS use https://www.${amazonDomain}. Never use a different Amazon domain unless the user explicitly requests it.`;
    }
    // Append credential instructions to custom prompts too
    systemPrompt += `\n\nWhen the user provides login credentials (email and password) for any store or service, use the save_store_credentials function to save them securely. NEVER repeat the password in your response — only confirm the email and store name.\n\nWhen the user asks to remove or delete their login for a store, use the remove_store_credentials function.`;
  } else {
    systemPrompt = buildDefaultPrompt(ownerName, botName, capabilities, language, amazonDomain);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    tools: credentialTools,
  });

  // Load history from PostgreSQL (persists across restarts)
  const history = await getDbHistory(ctx.botId, chatId);

  try {
    const chatSession = model.startChat({ history });
    const result = await chatSession.sendMessage(userMessage);
    const fnCalls = result.response.functionCalls();

    if (fnCalls && fnCalls.length > 0) {
      const fc = fnCalls[0];
      // Don't add to history yet — the webhook will handle the function call
      // and send the result back
      return {
        text: "",
        functionCall: { name: fc.name, args: fc.args as Record<string, unknown> },
      };
    }

    let response = result.response.text();

    // Truncate if too long for Telegram
    if (response.length > MAX_RESPONSE_LENGTH) {
      response = response.substring(0, MAX_RESPONSE_LENGTH - 20) + "\n\n[resposta truncada]";
    }

    // Persist to PostgreSQL
    await saveDbMessage(ctx.botId, chatId, "user", userMessage);
    await saveDbMessage(ctx.botId, chatId, "model", response);

    return { text: response };
  } catch (err) {
    console.error("[Gemini] Error:", err);
    return { text: "Erro ao processar sua mensagem. Tente novamente." };
  }
}
