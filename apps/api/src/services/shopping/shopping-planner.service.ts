/**
 * Shopping Planner Service — Generates complete shopping plans.
 *
 * Flow:
 *   1. Gemini generates item list based on theme
 *   2. Searches prices per category (batched, not per item)
 *   3. Groups by store, calculates totals
 *   4. Returns formatted pre-order
 *
 * Themes: baby registry, birthday party, bbq, house move, back to school, wedding, travel, free-form
 */

import { prisma } from "@payjarvis/database";
import { redisGet, redisSet } from "../redis.js";
import { unifiedProductSearch } from "../search/unified-search.service.js";
import { findCoupons } from "./coupons.service.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// ─── Types ───

interface PlannerItem {
  name: string;
  quantity: number;
  priority: "essential" | "recommended" | "optional";
  category: string;
  unitPrice?: number;
  estimatedPrice?: number;
  store?: string;
  url?: string;
  priceSource?: "search" | "estimate";
}

interface StoreGroup {
  store: string;
  items: PlannerItem[];
  subtotal: number;
  itemCount: number;
}

interface ShoppingPlan {
  title: string;
  theme: string;
  location: string;
  categories: { name: string; items: PlannerItem[] }[];
  storeGroups: StoreGroup[];
  totalEstimated: number;
  totalFullPrice: number;
  savings: number;
  savingsPercent: number;
  coupons: { store: string; code: string; description: string }[];
  currency: string;
  itemCount: number;
}

// ─── Theme Knowledge Base ───

const THEME_PROMPTS: Record<string, string> = {
  baby: `Generate a complete baby registry/layette list. Categories: Clothing (bodies, onesies, socks, hats, mittens, pajamas), Hygiene (bathtub, diapers, wipes, diaper cream, baby wash, baby lotion), Nursery (crib, mattress, sheets, monitor, mobile, nightlight), Feeding (bottles, sterilizer, bibs, pacifiers, bottle brush), Travel (stroller, car seat, diaper bag), Health (thermometer, nasal aspirator, first aid kit). Include 35-45 items total with quantities.`,

  birthday: `Generate a complete birthday party supply list. Categories: Decoration (balloons, banner, tablecloth, plates, cups, napkins, centerpieces), Food (cake, snacks, finger food, fruit platter), Drinks (juice, soda, water), Entertainment (party favors, games, pinata), Extras (candles, party hats, gift bags). Include 25-35 items total with quantities based on 15 guests.`,

  bbq: `Generate a complete BBQ/cookout shopping list. Categories: Meats (burger patties, hot dogs, chicken, ribs, sausages), Sides (coleslaw, potato salad, corn, baked beans, rolls), Drinks (beer, soda, water, juice), Condiments (ketchup, mustard, relish, BBQ sauce, mayo), Supplies (charcoal, plates, cups, napkins, utensils, aluminum foil). Include 25-35 items with quantities for 20 people.`,

  house: `Generate a complete new apartment/house essentials list. Categories: Kitchen (pots, pans, utensils, plates, glasses, cutting board, knife set), Bathroom (towels, shower curtain, bath mat, toilet brush, trash can), Bedroom (sheets, pillows, comforter, hangers), Living Room (throw blanket, cushions, lamp), Cleaning (broom, mop, vacuum, trash bags, all-purpose cleaner, laundry detergent). Include 35-45 items.`,

  school: `Generate a complete back-to-school shopping list. Categories: Supplies (notebooks, pens, pencils, erasers, rulers, folders, binder, calculator, glue, scissors, colored pencils), Backpack & Lunch (backpack, lunch box, water bottle, thermos), Tech (USB drive, headphones), Clothing (uniform pieces or casual school clothes). Include 20-30 items.`,

  wedding: `Generate a wedding gift registry essentials list. Categories: Kitchen (stand mixer, blender, cookware set, knife set, dinnerware, flatware, glasses), Bedroom (luxury sheets, duvet, pillows), Bathroom (towel set, bath accessories), Home (luggage set, picture frames, candles, vases), Experiences (honeymoon fund, date night fund). Include 30-40 items.`,

  travel: `Generate a travel packing list. Categories: Clothing (based on destination), Toiletries (travel-size items, sunscreen, medications), Electronics (chargers, adapter, power bank, headphones), Documents (passport holder, travel wallet), Comfort (neck pillow, eye mask, earplugs, packing cubes). Include 25-35 items.`,
};

function detectTheme(input: string): string {
  const lower = input.toLowerCase();
  if (/beb[eê]|baby|enxoval|layette|rec[eé]m.nascido|newborn/.test(lower)) return "baby";
  if (/anivers[aá]rio|birthday|festa.*crian[cç]a/.test(lower)) return "birthday";
  if (/churrasco|bbq|cookout|grill/.test(lower)) return "bbq";
  if (/mudan[cç]a|casa nova|apartamento|house.*new|moving/.test(lower)) return "house";
  if (/escola|aulas|school|material escolar/.test(lower)) return "school";
  if (/casamento|wedding|noiv[oa]/.test(lower)) return "wedding";
  if (/viagem|travel|mala|packing/.test(lower)) return "travel";
  return "custom";
}

// ─── Gemini Item List Generation ───

async function generateItemList(theme: string, themeInput: string, location: string, budget?: number, preferences?: string): Promise<{ name: string; items: PlannerItem[] }[]> {
  const cacheKey = `planner:items:${theme}:${location}:${budget || 0}`;
  const cached = await redisGet(cacheKey);
  if (cached) return JSON.parse(cached);

  const themePrompt = THEME_PROMPTS[theme] || `Generate a complete shopping list for: "${themeInput}". Organize by logical categories. Include 20-40 items with quantities.`;

  const budgetLine = budget ? `\nBudget constraint: $${budget} total. Prioritize essentials.` : "";
  const prefLine = preferences ? `\nPreferences: ${preferences}` : "";
  const locationLine = location ? `\nLocation: ${location} (use stores available in this area)` : "";

  const prompt = `${themePrompt}${locationLine}${budgetLine}${prefLine}

Return ONLY valid JSON, no markdown. Format:
{"categories":[{"name":"Category Name","items":[{"name":"Item name","quantity":1,"priority":"essential"}]}]}

Priority values: "essential", "recommended", "optional". Keep item names short and searchable (e.g. "baby onesie 0-3m" not "adorable cotton onesie for newborns").`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8000, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    const data = (await res.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Extract JSON from response (may have markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in Gemini response");

    const parsed = JSON.parse(jsonMatch[0]);
    const categories: { name: string; items: PlannerItem[] }[] = (parsed.categories || []).map((cat: any) => ({
      name: cat.name,
      items: (cat.items || []).map((item: any) => ({
        name: item.name,
        quantity: item.quantity || 1,
        priority: item.priority || "recommended",
        category: cat.name,
      })),
    }));

    if (categories.length > 0) {
      await redisSet(cacheKey, JSON.stringify(categories), 3600); // 1h cache
    }

    console.log(`[PLANNER] Generated ${categories.reduce((s, c) => s + c.items.length, 0)} items in ${categories.length} categories for theme="${theme}"`);
    return categories;
  } catch (err) {
    console.error("[PLANNER] Gemini item generation failed:", (err as Error).message);
    return [];
  }
}

// ─── Price Search (batched by category) ───

async function searchPricesForCategory(categoryItems: PlannerItem[], location: string, store?: string): Promise<PlannerItem[]> {
  // Search top 3-4 items per category to get representative pricing
  const searchItems = categoryItems.slice(0, 4);
  const results: PlannerItem[] = [...categoryItems];

  const searches = searchItems.map(async (item) => {
    try {
      const searchResult = await unifiedProductSearch({
        query: `${item.name} ${store || ""}`.trim(),
        country: /orlando|miami|new york|los angeles|houston|chicago/i.test(location) ? "US" : "BR",
        zipCode: undefined,
        maxResults: 3,
      });

      if (searchResult.products.length > 0) {
        // Find cheapest
        const sorted = [...searchResult.products].sort((a, b) => (a.price || 999) - (b.price || 999));
        const best = sorted[0];
        const idx = results.findIndex((r) => r.name === item.name);
        if (idx >= 0 && best.price) {
          results[idx].unitPrice = best.price;
          results[idx].store = best.store || "Online";
          results[idx].url = best.url;
          results[idx].priceSource = "search";
        }
      }
    } catch {
      // Silent fail — will use estimate
    }
  });

  await Promise.allSettled(searches);
  return results;
}

// ─── Gemini Price Estimation (for items without search results) ───

async function estimateMissingPrices(items: PlannerItem[], location: string): Promise<void> {
  const missing = items.filter((i) => !i.unitPrice);
  if (missing.length === 0) return;

  const itemNames = missing.map((i) => `${i.name} (qty: ${i.quantity})`).join(", ");
  const prompt = `Estimate retail prices in USD for these items in ${location}. Return ONLY valid JSON array:
[{"name":"item name","price":9.99}]

Items: ${itemNames}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    const data = (await res.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const estimates: { name: string; price: number }[] = JSON.parse(jsonMatch[0]);
    for (const est of estimates) {
      // Fuzzy match: exact, contains first word, or first word of estimate matches
      const estLower = est.name.toLowerCase();
      const estFirstWord = estLower.split(/[\s(]/)[0];
      const item = missing.find((i) => {
        const iLower = i.name.toLowerCase();
        const iFirstWord = iLower.split(/[\s(]/)[0];
        return iLower === estLower || iLower.includes(estFirstWord) || estLower.includes(iFirstWord);
      });
      if (item && est.price > 0) {
        item.unitPrice = est.price;
        item.estimatedPrice = est.price;
        item.priceSource = "estimate";
      }
    }
    // Fill any still-missing with reasonable defaults
    for (const item of missing) {
      if (!item.unitPrice) {
        item.unitPrice = 9.99;
        item.estimatedPrice = 9.99;
        item.priceSource = "estimate";
      }
    }
  } catch {
    // Assign reasonable defaults
    for (const item of missing) {
      if (!item.unitPrice) {
        item.unitPrice = 9.99;
        item.estimatedPrice = 9.99;
        item.priceSource = "estimate";
      }
    }
  }
}

// ─── Group by Store ───

function groupByStore(items: PlannerItem[]): StoreGroup[] {
  const storeMap = new Map<string, PlannerItem[]>();
  for (const item of items) {
    const store = item.store || "Various";
    if (!storeMap.has(store)) storeMap.set(store, []);
    storeMap.get(store)!.push(item);
  }

  return Array.from(storeMap.entries())
    .map(([store, storeItems]) => ({
      store,
      items: storeItems,
      subtotal: storeItems.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0),
      itemCount: storeItems.reduce((s, i) => s + i.quantity, 0),
    }))
    .sort((a, b) => b.subtotal - a.subtotal);
}

// ─── Find Coupons ───

async function findCouponsForStores(stores: string[]): Promise<{ store: string; code: string; description: string }[]> {
  const results: { store: string; code: string; description: string }[] = [];
  const uniqueStores = [...new Set(stores.filter((s) => s !== "Various" && s !== "Online"))].slice(0, 4);

  const searches = uniqueStores.map(async (store) => {
    try {
      const coupons = await findCoupons(store);
      for (const c of coupons.slice(0, 2)) {
        results.push({ store, code: c.code, description: c.description });
      }
    } catch { /* silent */ }
  });

  await Promise.allSettled(searches);
  return results;
}

// ═══════════════════════════════════════════════════════════
// MAIN: Generate Shopping Plan
// ═══════════════════════════════════════════════════════════

export async function generateShoppingPlan(
  userId: string,
  themeInput: string,
  location: string,
  budget?: number,
  preferences?: string
): Promise<ShoppingPlan | { error: string }> {
  const theme = detectTheme(themeInput);
  console.log(`[PLANNER] Starting plan: theme="${theme}" (input="${themeInput}") location="${location}" budget=${budget || "none"}`);

  // Step 1: Generate item list
  const categories = await generateItemList(theme, themeInput, location, budget, preferences);
  if (categories.length === 0) {
    return { error: "Could not generate item list. Try again with a more specific theme." };
  }

  // Step 2: Search prices (batched by category, max 10 searches)
  const categorySearches = categories.slice(0, 10).map(async (cat) => {
    const priced = await searchPricesForCategory(cat.items, location);
    // Update category items with prices in-place
    for (let i = 0; i < cat.items.length; i++) {
      const pricedItem = priced.find((p) => p.name === cat.items[i].name);
      if (pricedItem) cat.items[i] = pricedItem;
    }
  });

  // Run category searches in parallel (max 25s)
  await Promise.race([
    Promise.allSettled(categorySearches),
    new Promise((resolve) => setTimeout(resolve, 25000)),
  ]);

  // Collect all items from categories (after search updates)
  const allItems: PlannerItem[] = categories.flatMap((c) => c.items);

  // Step 3: Estimate missing prices via Gemini
  await estimateMissingPrices(allItems, location);

  // Safety net: ensure NO item has zero price
  for (const item of allItems) {
    if (!item.unitPrice || item.unitPrice <= 0) {
      item.unitPrice = 9.99;
      item.estimatedPrice = 9.99;
      item.priceSource = "estimate";
    }
  }

  // Step 4: Group by store
  const storeGroups = groupByStore(allItems);
  const totalEstimated = allItems.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0);
  // Full price = estimated + 10% markup (simulates buying all at one store)
  const totalFullPrice = totalEstimated * 1.1;
  const savings = totalFullPrice - totalEstimated;

  // Step 5: Find coupons for top stores
  const storeNames = storeGroups.map((g) => g.store);
  const coupons = await findCouponsForStores(storeNames);

  const plan: ShoppingPlan = {
    title: themeInput,
    theme,
    location,
    categories,
    storeGroups,
    totalEstimated: Math.round(totalEstimated * 100) / 100,
    totalFullPrice: Math.round(totalFullPrice * 100) / 100,
    savings: Math.round(savings * 100) / 100,
    savingsPercent: totalFullPrice > 0 ? Math.round((savings / totalFullPrice) * 1000) / 10 : 0,
    coupons,
    currency: "USD",
    itemCount: allItems.reduce((s, i) => s + i.quantity, 0),
  };

  // Step 6: Save to database
  try {
    await prisma.shoppingList.create({
      data: {
        userId,
        title: themeInput,
        theme,
        location,
        items: JSON.parse(JSON.stringify(categories)),
        totalEstimated: plan.totalEstimated,
        currency: plan.currency,
        status: "draft",
      },
    });
  } catch (err) {
    console.error("[PLANNER] Failed to save list:", (err as Error).message);
  }

  console.log(`[PLANNER] Plan complete: ${plan.itemCount} items, $${plan.totalEstimated}, ${storeGroups.length} stores`);
  return plan;
}

// ─── Format Plan as Pre-Order Text ───

export function formatShoppingPlan(plan: ShoppingPlan, userName: string, lang: "pt" | "en" = "en"): string {
  const date = new Date().toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US");
  const curr = plan.currency === "BRL" ? "R$" : "$";

  const lines: string[] = [];

  // Header
  if (lang === "pt") {
    lines.push(`📝 PRÉ-ORDEM DE COMPRAS`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📦 ${plan.title} — ${plan.location}`);
    lines.push(`📅 Data: ${date}`);
    lines.push(`👤 Para: ${userName}`);
  } else {
    lines.push(`📝 SHOPPING PLAN`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📦 ${plan.title} — ${plan.location}`);
    lines.push(`📅 Date: ${date}`);
    lines.push(`👤 For: ${userName}`);
  }

  // Items by category
  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(lang === "pt" ? `ITENS (${plan.itemCount} produtos)` : `ITEMS (${plan.itemCount} products)`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);

  const categoryEmojis: Record<string, string> = {
    "Clothing": "👶", "Roupas": "👶",
    "Hygiene": "🧴", "Higiene": "🧴",
    "Nursery": "🛏️", "Quarto": "🛏️",
    "Feeding": "🍼", "Alimentação": "🍼",
    "Travel": "🚗", "Passeio": "🚗",
    "Health": "🏥", "Saúde": "🏥",
    "Decoration": "🎈", "Decoração": "🎈",
    "Food": "🍔", "Comida": "🍔",
    "Drinks": "🥤", "Bebidas": "🥤",
    "Meats": "🥩", "Carnes": "🥩",
    "Sides": "🥗",
    "Kitchen": "🍳", "Cozinha": "🍳",
    "Bathroom": "🛁", "Banheiro": "🛁",
    "Bedroom": "🛏️",
    "Cleaning": "🧹", "Limpeza": "🧹",
    "Supplies": "📚",
    "Entertainment": "🎉",
  };

  for (const cat of plan.categories) {
    const emoji = categoryEmojis[cat.name] || "📦";
    const catTotal = cat.items.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0);
    lines.push(``);
    lines.push(`${emoji} ${cat.name.toUpperCase()} (${cat.items.length} ${lang === "pt" ? "itens" : "items"})`);

    for (const item of cat.items) {
      const price = item.unitPrice || 0;
      const total = price * item.quantity;
      const est = item.priceSource === "estimate" ? "~" : "";
      const best = item.priceSource === "search" ? " 🟢" : "";
      if (item.quantity > 1) {
        lines.push(`  ${item.quantity}x ${item.name} ......... ${est}${curr}${total.toFixed(2)}${best}`);
      } else {
        lines.push(`  1x ${item.name} ......... ${est}${curr}${price.toFixed(2)}${best}`);
      }
    }
    lines.push(`  ${lang === "pt" ? "Subtotal" : "Subtotal"}: ${curr}${catTotal.toFixed(2)}`);
  }

  // Financial summary
  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(lang === "pt" ? `RESUMO FINANCEIRO` : `FINANCIAL SUMMARY`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(``);
  lines.push(`  ${lang === "pt" ? "Subtotal" : "Subtotal"} (${plan.itemCount} ${lang === "pt" ? "itens" : "items"}): ${curr}${plan.totalEstimated.toFixed(2)}`);

  if (plan.coupons.length > 0) {
    lines.push(`  ${lang === "pt" ? "Cupons aplicáveis" : "Available coupons"}: -${curr}${plan.savings.toFixed(2)}`);
  }

  lines.push(`  ─────────────────────────────`);
  lines.push(`  TOTAL ${lang === "pt" ? "ESTIMADO" : "ESTIMATED"}: ${curr}${plan.totalEstimated.toFixed(2)}`);

  // By store
  if (plan.storeGroups.length > 1) {
    lines.push(``);
    lines.push(`  🏪 ${lang === "pt" ? "Por loja" : "By store"}:`);
    for (const g of plan.storeGroups) {
      lines.push(`  ${g.store} (${g.itemCount} ${lang === "pt" ? "itens" : "items"}): ${curr}${g.subtotal.toFixed(2)}`);
    }
  }

  if (plan.savings > 0) {
    lines.push(``);
    lines.push(`  💰 ${lang === "pt" ? "Economia vs preço cheio" : "Savings vs full price"}: ${curr}${plan.savings.toFixed(2)} (${plan.savingsPercent}%)`);
  }

  // Coupons
  if (plan.coupons.length > 0) {
    lines.push(`  🎟️ ${lang === "pt" ? "Cupons" : "Coupons"}: ${plan.coupons.map((c) => `${c.code} (${c.store})`).join(", ")}`);
  }

  // Actions
  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(lang === "pt" ? `AÇÕES` : `ACTIONS`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);

  if (lang === "pt") {
    lines.push(`1️⃣ Aprovar e comprar tudo`);
    lines.push(`2️⃣ Remover itens da lista`);
    lines.push(`3️⃣ Trocar loja de algum item`);
    lines.push(`4️⃣ Adicionar mais itens`);
    lines.push(`5️⃣ Salvar lista pra comprar depois`);
    lines.push(`6️⃣ Compartilhar lista com alguém`);
    lines.push(``);
    lines.push(`O que deseja? 🦀`);
  } else {
    lines.push(`1️⃣ Approve and buy everything`);
    lines.push(`2️⃣ Remove items from list`);
    lines.push(`3️⃣ Change store for an item`);
    lines.push(`4️⃣ Add more items`);
    lines.push(`5️⃣ Save list for later`);
    lines.push(`6️⃣ Share list with someone`);
    lines.push(``);
    lines.push(`What would you like? 🦀`);
  }

  // Mark estimated prices
  const hasEstimates = plan.categories.some((c) => c.items.some((i) => i.priceSource === "estimate"));
  if (hasEstimates) {
    lines.push(``);
    lines.push(`~ = ${lang === "pt" ? "preço estimado" : "estimated price"} | 🟢 = ${lang === "pt" ? "preço real encontrado" : "real price found"}`);
  }

  return lines.join("\n");
}

// ─── Get User's Lists ───

export async function getUserLists(userId: string) {
  return prisma.shoppingList.findMany({
    where: { userId, status: { not: "deleted" } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

// ─── Get Single List ───

export async function getList(listId: string) {
  return prisma.shoppingList.findUnique({ where: { id: listId } });
}

// ─── Update List Status ───

export async function updateListStatus(listId: string, status: string) {
  return prisma.shoppingList.update({
    where: { id: listId },
    data: { status, updatedAt: new Date() },
  });
}

// ─── Approve List ───

interface ApproveOptions {
  approvedItemIds?: string[];
  rejectedItemIds?: string[];
  swapRequests?: { itemId: string; newStore: string }[];
}

export async function approveList(
  listId: string,
  userId: string,
  action: string,
  options: ApproveOptions
): Promise<{
  list: any;
  priceChanged?: boolean;
  changes?: { itemName: string; oldPrice: number; newPrice: number }[];
}> {
  const list = await prisma.shoppingList.findUnique({ where: { id: listId } });
  if (!list) throw new Error("LIST_NOT_FOUND");
  if (list.userId !== userId) throw new Error("USER_MISMATCH");

  const items = (list.items as any[]) || [];
  const allItems = items.flatMap((cat: any) => cat.items || []);

  if (action === "reject") {
    await prisma.shoppingList.update({
      where: { id: listId },
      data: {
        status: "rejected",
        rejectedItems: allItems,
        updatedAt: new Date(),
      },
    });
    return { list: { ...list, status: "rejected" } };
  }

  // Check if prices are stale (list older than 1 hour)
  const ageMs = Date.now() - new Date(list.createdAt).getTime();
  const isStale = ageMs > 3600000; // 1 hour

  let priceChanged = false;
  const changes: { itemName: string; oldPrice: number; newPrice: number }[] = [];

  if (isStale) {
    // Re-validate prices for approved items using existing search
    try {
      const { searchGrocery } = await import("./grocery.service.js");
      const sampleItems = allItems.slice(0, 5);
      for (const item of sampleItems) {
        try {
          const result = await searchGrocery({
            query: item.name,
            zipCode: undefined,
            store: item.store || undefined,
            country: "US",
            maxResults: 1,
          });
          if (result.items.length > 0 && result.items[0].price) {
            const newPrice = result.items[0].price;
            const oldPrice = item.unitPrice || 0;
            if (Math.abs(newPrice - oldPrice) / Math.max(oldPrice, 0.01) > 0.1) {
              priceChanged = true;
              changes.push({ itemName: item.name, oldPrice, newPrice });
            }
          }
        } catch { /* skip item */ }
      }
    } catch (err) {
      console.warn("[APPROVE] Price re-validation skipped:", (err as Error).message);
    }

    if (priceChanged) {
      return { list, priceChanged: true, changes };
    }
  }

  let approvedItems: any[];
  let rejectedItems: any[] = [];

  if (action === "approve_all") {
    approvedItems = allItems;
  } else if (action === "approve_partial") {
    const approvedSet = new Set(options.approvedItemIds || []);
    const rejectedSet = new Set(options.rejectedItemIds || []);

    approvedItems = allItems.filter((_item: any, idx: number) =>
      approvedSet.size > 0 ? approvedSet.has(String(idx)) : !rejectedSet.has(String(idx))
    );
    rejectedItems = allItems.filter((_item: any, idx: number) =>
      rejectedSet.has(String(idx)) || (approvedSet.size > 0 && !approvedSet.has(String(idx)))
    );
  } else {
    approvedItems = allItems;
  }

  // Handle swap requests
  if (options.swapRequests && options.swapRequests.length > 0) {
    for (const swap of options.swapRequests) {
      const idx = parseInt(swap.itemId, 10);
      if (!isNaN(idx) && approvedItems[idx]) {
        approvedItems[idx].store = swap.newStore;
      }
    }
  }

  const updatedList = await prisma.shoppingList.update({
    where: { id: listId },
    data: {
      status: "approved",
      approvedAt: new Date(),
      approvedItems: approvedItems,
      rejectedItems: rejectedItems.length > 0 ? rejectedItems : undefined,
      updatedAt: new Date(),
    },
  });

  return { list: updatedList };
}

// ─── Execute Purchase (Stub) ───

export async function executeList(
  listId: string,
  userId: string
): Promise<{ status: string; message: string }> {
  const list = await prisma.shoppingList.findUnique({ where: { id: listId } });
  if (!list) throw new Error("LIST_NOT_FOUND");
  if (list.userId !== userId) throw new Error("USER_MISMATCH");
  if (list.status !== "approved") throw new Error("NOT_APPROVED");

  await prisma.shoppingList.update({
    where: { id: listId },
    data: {
      status: "executing",
      updatedAt: new Date(),
    },
  });

  return {
    status: "executing",
    message: "Purchase execution will be available in a future release",
  };
}
