/**
 * Commerce Service: eBay (Products Global)
 *
 * Auth: OAuth2 client_credentials
 * Base: https://api.sandbox.ebay.com (sandbox) / https://api.ebay.com (production)
 * Browse API: /buy/browse/v1
 */

const EBAY_BASE = process.env.EBAY_BASE_URL || "https://api.sandbox.ebay.com";

let token: string | null = null;
let tokenExpiry = 0;

function isConfigured(): boolean {
  return !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET
    && process.env.EBAY_CLIENT_ID !== "CHANGE_ME");
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && token && Date.now() < tokenExpiry) return token;

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${EBAY_BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  const data = await res.json() as any;
  if (!res.ok) throw new Error(data.error_description || "eBay auth failed");

  token = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return token!;
}

async function ebayGet(path: string, params: Record<string, string> = {}, retry = true): Promise<any> {
  const t = await getToken();
  const qs = new URLSearchParams(params).toString();
  const url = `${EBAY_BASE}${path}${qs ? "?" + qs : ""}`;

  console.log(`[EBAY] GET ${path} params=${JSON.stringify(params)}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${t}` },
  });

  if (res.status === 401 && retry) {
    console.log("[EBAY] 401 — refreshing token");
    token = null;
    tokenExpiry = 0;
    return ebayGet(path, params, false);
  }

  const data = await res.json() as any;
  if (!res.ok) {
    throw new Error(data.errors?.[0]?.message || "eBay API error");
  }
  return data;
}

// ─── Interfaces ──────────────────────────────────────

export interface EbaySearchParams {
  query: string;
  category?: string;
  priceMin?: number;
  priceMax?: number;
  condition?: string;    // "NEW", "USED"
  sort?: string;         // "BEST_MATCH", "PRICE", "-PRICE", "NEWLY_LISTED"
  limit?: number;
}

export interface EbayProduct {
  id: string;
  title: string;
  price: number;
  currency: string;
  shippingCost: string;
  image: string;
  url: string;
  condition: string;
  sellerName: string;
  sellerFeedback: string;
  buyingFormat: string;
}

// ─── Search ──────────────────────────────────────────

export async function searchEbayProducts(params: EbaySearchParams): Promise<{
  source: string;
  mock: boolean;
  results: EbayProduct[];
  error?: string;
}> {
  if (!isConfigured()) {
    return { source: "ebay", mock: true, results: mockEbayProducts(params) };
  }

  try {
    const query: Record<string, string> = {
      q: params.query,
      limit: String(params.limit ?? 10),
    };

    // Build filter string
    const filters: string[] = [];
    if (params.priceMin || params.priceMax) {
      const min = params.priceMin ?? 0;
      const max = params.priceMax ?? '';
      filters.push(`price:[${min}..${max}]`);
      filters.push("priceCurrency:USD");
    }
    if (params.condition) {
      filters.push(`conditions:{${params.condition}}`);
    }
    if (filters.length > 0) query.filter = filters.join(",");

    if (params.sort) {
      const sortMap: Record<string, string> = {
        'BEST_MATCH': 'BEST_MATCH',
        'PRICE': 'price',
        '-PRICE': '-price',
        'NEWLY_LISTED': 'newlyListed',
        'price_asc': 'price',
        'price_desc': '-price',
      };
      query.sort = sortMap[params.sort] || 'BEST_MATCH';
    }

    const data = await ebayGet("/buy/browse/v1/item_summary/search", query);

    const results: EbayProduct[] = (data.itemSummaries || []).slice(0, params.limit ?? 10).map((item: any) => ({
      id: item.itemId || '',
      title: item.title || 'Unknown',
      price: parseFloat(item.price?.value || '0'),
      currency: item.price?.currency || 'USD',
      shippingCost: item.shippingOptions?.[0]?.shippingCost?.value
        ? `$${item.shippingOptions[0].shippingCost.value}`
        : 'See listing',
      image: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || '',
      url: item.itemWebUrl || '',
      condition: item.condition || 'N/A',
      sellerName: item.seller?.username || 'Seller',
      sellerFeedback: item.seller?.feedbackPercentage
        ? `${item.seller.feedbackPercentage}% positive`
        : 'N/A',
      buyingFormat: item.buyingOptions?.includes('FIXED_PRICE') ? 'Buy It Now' : 'Auction',
    }));

    return { source: "ebay", mock: false, results };
  } catch (err) {
    console.error("[EBAY] Search error:", err instanceof Error ? err.message : err);
    return {
      source: "ebay",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "eBay search failed",
    };
  }
}

// ─── Product Details ─────────────────────────────────

export async function getEbayProduct(itemId: string): Promise<{
  source: string;
  product: any | null;
  error?: string;
}> {
  if (!isConfigured()) {
    return { source: "ebay", product: null, error: "eBay API not configured" };
  }

  try {
    const data = await ebayGet(`/buy/browse/v1/item/${itemId}`);
    return { source: "ebay", product: data };
  } catch (err) {
    return {
      source: "ebay",
      product: null,
      error: err instanceof Error ? err.message : "Failed to get product details",
    };
  }
}

// ─── Format for Telegram ─────────────────────────────

export function formatEbayResults(results: EbayProduct[]): string {
  if (results.length === 0) {
    return "No products found on eBay with those criteria.";
  }

  const items = results.slice(0, 5).map((p, i) => {
    const parts = [
      `${i + 1}. 🛍️ ${p.title}`,
      `   💰 $${p.price.toFixed(2)} ${p.shippingCost !== 'See listing' ? `+ ${p.shippingCost} shipping` : ''}`,
      `   📦 ${p.condition} · ${p.buyingFormat}`,
      `   ⭐ ${p.sellerName} (${p.sellerFeedback})`,
    ];
    return parts.join("\n");
  });

  return items.join("\n\n") + "\n\nWant more details? Tell me the number.";
}

// ─── Mock Data ───────────────────────────────────────

function mockEbayProducts(params: EbaySearchParams): EbayProduct[] {
  return [
    {
      id: "mock-ebay-001", title: `${params.query} - Premium Quality`,
      price: 299.99, currency: "USD", shippingCost: "$9.99",
      image: "", url: "#", condition: "New", sellerName: "TopDeals",
      sellerFeedback: "99.2% positive", buyingFormat: "Buy It Now",
    },
    {
      id: "mock-ebay-002", title: `${params.query} - Like New Condition`,
      price: 189.50, currency: "USD", shippingCost: "Free",
      image: "", url: "#", condition: "Used", sellerName: "BargainHunt",
      sellerFeedback: "98.7% positive", buyingFormat: "Buy It Now",
    },
    {
      id: "mock-ebay-003", title: `${params.query} - Refurbished`,
      price: 149.00, currency: "USD", shippingCost: "$5.99",
      image: "", url: "#", condition: "Refurbished", sellerName: "CertifiedStore",
      sellerFeedback: "99.8% positive", buyingFormat: "Buy It Now",
    },
  ];
}
