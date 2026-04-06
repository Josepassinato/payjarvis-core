/**
 * Deals Channel Cron — Posts best deals to @SnifferOfertas Telegram channel
 * Runs every 6 hours. Searches trending products and posts savings cards.
 */

import cron from "node-cron";
import { execFileSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DEALS_CHANNEL_ID = process.env.SNIFFER_DEALS_CHANNEL_ID || ""; // e.g. "@SnifferOfertas" or "-100xxxx"
const API_URL = process.env.API_URL || "http://127.0.0.1:3001";
const RECEIPT_CARD_SCRIPT = "/root/Payjarvis/scripts/generate_receipt_card.py";

interface Product {
  title: string;
  price: number;
  store: string;
  url: string;
  isApproximate?: boolean;
}

interface SearchResult {
  success: boolean;
  data?: {
    products: Product[];
    method: string;
  };
}

const TRENDING_QUERIES = [
  "AirPods Pro",
  "JBL Tune 520BT",
  "Echo Dot 5th",
  "Nintendo Switch",
  "Kindle Paperwhite",
  "Samsung Galaxy Buds",
  "Instant Pot",
  "Air Fryer",
  "Robot Vacuum",
  "Mechanical Keyboard",
];

async function searchProduct(query: string): Promise<Product[]> {
  try {
    const res = await fetch(`${API_URL}/api/retail/unified-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, maxResults: 5, country: "US" }),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json()) as SearchResult;
    if (data.success && data.data?.products) {
      return data.data.products.filter((p) => p.price && p.price > 0);
    }
  } catch (err) {
    console.error(`[Deals Cron] Search failed for "${query}":`, (err as Error).message);
  }
  return [];
}

async function sendToChannel(imagePath: string, caption: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !DEALS_CHANNEL_ID) return false;

  try {
    const imageBuffer = readFileSync(imagePath);
    const boundary = `----FormBoundary${Date.now()}`;
    const parts: Buffer[] = [];

    const addField = (name: string, value: string) => {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    };
    addField("chat_id", DEALS_CHANNEL_ID);
    addField("caption", caption);
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="deal.png"\r\nContent-Type: image/png\r\n\r\n`));
    parts.push(imageBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const result = await res.json();
    return (result as any).ok === true;
  } catch (err) {
    console.error("[Deals Cron] Send to channel failed:", (err as Error).message);
    return false;
  }
}

async function runDealsJob() {
  if (!DEALS_CHANNEL_ID) {
    console.log("[Deals Cron] SNIFFER_DEALS_CHANNEL_ID not set, skipping");
    return;
  }

  console.log("[Deals Cron] Starting deals search...");
  let posted = 0;

  // Pick 3 random queries
  const shuffled = [...TRENDING_QUERIES].sort(() => Math.random() - 0.5);
  const queries = shuffled.slice(0, 3);

  for (const query of queries) {
    try {
      const products = await searchProduct(query);
      if (products.length < 2) continue;

      const prices = products.map((p) => p.price);
      const minPrice = Math.min(...prices);
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const savingsPct = ((avgPrice - minPrice) / avgPrice) * 100;

      if (savingsPct < 10) continue;

      const best = products.find((p) => p.price === minPrice)!;
      const savings = avgPrice - minPrice;

      // Generate card
      const tmpPath = `/tmp/deals_${Date.now()}.png`;
      execFileSync("python3", [
        RECEIPT_CARD_SCRIPT,
        "--product", (best.title || query).substring(0, 60),
        "--price", String(minPrice),
        "--avg", String(Math.round(avgPrice * 100) / 100),
        "--currency", "USD",
        "--output", tmpPath,
      ], { timeout: 15000 });

      const caption = [
        `🔥 ${best.title || query}`,
        `💰 $${minPrice.toFixed(2)} (média $${avgPrice.toFixed(2)})`,
        `📉 Economia: $${savings.toFixed(2)} (${savingsPct.toFixed(0)}%)`,
        `🏪 ${best.store || "Multiple stores"}`,
        best.url ? `🔗 ${best.url}` : "",
        "",
        "🐕 @SnifferOfertas — Fareja o melhor preço",
      ].filter(Boolean).join("\n");

      const sent = await sendToChannel(tmpPath, caption);
      try { unlinkSync(tmpPath); } catch (_) {}

      if (sent) {
        posted++;
        console.log(`[Deals Cron] Posted: "${best.title}" at $${minPrice}`);
      }

      // Rate limit: wait 3s between posts
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      console.error(`[Deals Cron] Error processing "${query}":`, (err as Error).message);
    }
  }

  console.log(`[Deals Cron] Done. Posted ${posted} deals.`);
}

// Every 6 hours: 00:00, 06:00, 12:00, 18:00 UTC
cron.schedule("0 */6 * * *", () => {
  runDealsJob().catch((err) => console.error("[Deals Cron] Fatal:", err));
});

console.log("[Cron] Deals channel: every 6h (0,6,12,18 UTC)");

export { runDealsJob };
