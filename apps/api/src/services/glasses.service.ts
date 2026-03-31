/**
 * Glasses Service — AI-powered product identification via camera/image
 *
 * Uses Gemini Vision to identify products from images, then searches
 * for prices across retail platforms. Supports voice commands:
 * "buy", "add_to_list", "compare", "next".
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Types ──────────────────────────────────────────────────────────

interface ProductResult {
  product: string;
  brand: string;
  category: string;
  price: number | null;
  store: string | null;
  imageUrl: string | null;
  alternatives: Array<{
    name: string;
    price: number;
    store: string;
    url?: string;
  }>;
}

interface ShoppingItem {
  product: string;
  brand: string;
  category: string;
  price: number | null;
  store: string | null;
  addedAt: string;
}

interface RetailSearchResult {
  results?: Array<{
    name: string;
    price: number;
    store: string;
    url?: string;
    imageUrl?: string;
  }>;
}

// ── In-memory caches ───────────────────────────────────────────────

const lastProductCache: Map<string, ProductResult> = new Map();
const shoppingListCache: Map<string, ShoppingItem[]> = new Map();

// ── Gemini client ──────────────────────────────────────────────────

function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenerativeAI(apiKey);
}

// ── Service functions ──────────────────────────────────────────────

/**
 * Identify a product from a base64 image using Gemini Vision,
 * then search for prices via the retail search API.
 */
export async function identifyProduct(
  imageBase64: string,
  userId: string
): Promise<ProductResult> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // 5-second timeout via AbortController
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    // Step 1: Identify product via Gemini Vision
    const prompt =
      'Identify this product. Return ONLY a JSON object: {"name": "product name", "brand": "brand if visible", "category": "category"}. No markdown, no explanation.';

    // Strip data URI prefix if present (e.g., "data:image/jpeg;base64,")
    const cleanBase64 = imageBase64.includes(",")
      ? imageBase64.split(",")[1]
      : imageBase64;

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: cleanBase64,
              },
            },
          ],
        },
      ],
    });

    const responseText = result.response.text().trim();

    // Parse the JSON response — handle potential markdown fences
    let cleaned = responseText;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let identified: { name: string; brand: string; category: string };
    try {
      identified = JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse Gemini response: ${responseText}`);
    }

    // Step 2: Search for prices via retail API
    let searchResults: RetailSearchResult = {};
    try {
      const searchResponse = await fetch("http://localhost:3001/api/retail/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: identified.name,
          platforms: ["amazon", "walmart", "target"],
        }),
        signal: controller.signal,
      });

      if (searchResponse.ok) {
        searchResults = (await searchResponse.json()) as RetailSearchResult;
      }
    } catch (err) {
      // Search failure is non-fatal — we still return the identification
      if ((err as Error).name === "AbortError") {
        console.warn("[Glasses] Retail search timed out");
      } else {
        console.warn("[Glasses] Retail search failed:", (err as Error).message);
      }
    }

    const items = searchResults.results || [];
    const bestMatch = items[0] || null;

    const productResult: ProductResult = {
      product: identified.name,
      brand: identified.brand,
      category: identified.category,
      price: bestMatch?.price ?? null,
      store: bestMatch?.store ?? null,
      imageUrl: bestMatch?.imageUrl ?? null,
      alternatives: items.slice(1, 6).map((item) => ({
        name: item.name,
        price: item.price,
        store: item.store,
        url: item.url,
      })),
    };

    // Cache for follow-up commands
    lastProductCache.set(userId, productResult);

    return productResult;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Execute a glasses command on the last identified product.
 * Supported commands: "buy", "add_to_list", "compare", "next".
 */
export async function executeGlassesCommand(
  command: string,
  userId: string,
  context: any
): Promise<{ success: boolean; message: string; data?: any }> {
  const lastProduct = lastProductCache.get(userId);

  if (!lastProduct && command !== "next") {
    return {
      success: false,
      message: "No product identified yet. Please scan a product first.",
    };
  }

  switch (command.toLowerCase()) {
    case "buy": {
      // Return purchase info — actual checkout is handled by the checkout flow
      return {
        success: true,
        message: `Ready to purchase: ${lastProduct!.product}`,
        data: {
          product: lastProduct!.product,
          brand: lastProduct!.brand,
          price: lastProduct!.price,
          store: lastProduct!.store,
          action: "redirect_to_checkout",
        },
      };
    }

    case "add_to_list": {
      const list = shoppingListCache.get(userId) || [];
      const item: ShoppingItem = {
        product: lastProduct!.product,
        brand: lastProduct!.brand,
        category: lastProduct!.category,
        price: lastProduct!.price,
        store: lastProduct!.store,
        addedAt: new Date().toISOString(),
      };
      list.push(item);
      shoppingListCache.set(userId, list);

      return {
        success: true,
        message: `Added "${lastProduct!.product}" to your shopping list.`,
        data: { item, listSize: list.length },
      };
    }

    case "compare": {
      // Return all alternatives for the last identified product
      return {
        success: true,
        message: `Comparing prices for: ${lastProduct!.product}`,
        data: {
          product: lastProduct!.product,
          currentPrice: lastProduct!.price,
          currentStore: lastProduct!.store,
          alternatives: lastProduct!.alternatives,
        },
      };
    }

    case "next": {
      // Clear the cache so the user can scan a new product
      lastProductCache.delete(userId);
      return {
        success: true,
        message: "Ready to scan the next product.",
      };
    }

    default:
      return {
        success: false,
        message: `Unknown command: "${command}". Supported: buy, add_to_list, compare, next.`,
      };
  }
}

/**
 * Get the shopping list for a user.
 */
export function getShoppingList(userId: string): ShoppingItem[] {
  return shoppingListCache.get(userId) || [];
}
