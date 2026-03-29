/**
 * Commerce Service: Mercado Libre (Products LATAM)
 *
 * Busca pública — NÃO precisa de auth!
 * Base: https://api.mercadolibre.com
 * Sites: MLB (Brasil), MLA (Argentina), MLM (México), MLC (Chile), MCO (Colômbia)
 */

const MELI_BASE = "https://api.mercadolibre.com";

const MELI_SITES: Record<string, string> = {
  'brasil': 'MLB', 'brazil': 'MLB', 'br': 'MLB',
  'argentina': 'MLA', 'ar': 'MLA',
  'mexico': 'MLM', 'méxico': 'MLM', 'mx': 'MLM',
  'chile': 'MLC', 'cl': 'MLC',
  'colombia': 'MCO', 'co': 'MCO',
  'uruguai': 'MLU', 'uruguay': 'MLU', 'uy': 'MLU',
  'peru': 'MPE', 'pe': 'MPE',
};

function resolveSiteId(country: string): string {
  const lower = country.trim().toLowerCase();
  return MELI_SITES[lower] || 'MLB';
}

// ─── Interfaces ──────────────────────────────────────

export interface MeliSearchParams {
  query: string;
  siteId?: string;       // MLB, MLA, MLM, etc.
  country?: string;      // "brasil", "argentina" — resolved to siteId
  category?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: string;         // "relevance", "price_asc", "price_desc"
  limit?: number;        // max 50, default 10
}

export interface MeliProduct {
  id: string;
  title: string;
  price: number;
  currency: string;
  thumbnail: string;
  permalink: string;
  condition: string;
  freeShipping: boolean;
  sellerName: string;
  sellerReputation: string;
  availableQuantity: number;
}

// ─── Search (PUBLIC — no auth needed) ────────────────

export async function searchMeliProducts(params: MeliSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: MeliProduct[];
  error?: string;
}> {
  const siteId = params.siteId || resolveSiteId(params.country || 'brasil');

  try {
    const query: Record<string, string> = {
      q: params.query,
      limit: String(params.limit ?? 10),
    };
    if (params.category) query.category = params.category;
    if (params.sort) {
      const sortMap: Record<string, string> = {
        'relevance': 'relevance',
        'price_asc': 'price_asc',
        'price_desc': 'price_desc',
      };
      query.sort = sortMap[params.sort] || 'relevance';
    }
    if (params.priceMin || params.priceMax) {
      const min = params.priceMin ?? 0;
      const max = params.priceMax ?? '';
      query.price = `${min}-${max}`;
    }

    const qs = new URLSearchParams(query).toString();
    const url = `${MELI_BASE}/sites/${siteId}/search?${qs}`;

    console.log(`[MELI] GET /sites/${siteId}/search q=${params.query}`);

    const res = await fetch(url);
    const data = await res.json() as any;

    if (!res.ok) {
      throw new Error(data.message || data.error || "Mercado Libre API error");
    }

    const results: MeliProduct[] = (data.results || []).slice(0, params.limit ?? 10).map((item: any) => ({
      id: item.id,
      title: item.title,
      price: item.price,
      currency: item.currency_id || 'BRL',
      thumbnail: item.thumbnail || '',
      permalink: item.permalink || '',
      condition: item.condition === 'new' ? 'Novo' : item.condition === 'used' ? 'Usado' : item.condition || 'N/A',
      freeShipping: item.shipping?.free_shipping || false,
      sellerName: item.seller?.nickname || 'Vendedor',
      sellerReputation: item.seller?.seller_reputation?.level_id || 'N/A',
      availableQuantity: item.available_quantity || 0,
    }));

    return { source: "mercadolibre", mock: false, results };
  } catch (err) {
    console.error("[MELI] Search error:", err instanceof Error ? err.message : err);
    return {
      source: "mercadolibre",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "Mercado Libre search failed",
    };
  }
}

// ─── Product Details ─────────────────────────────────

export async function getMeliProduct(itemId: string): Promise<{
  source: string;
  product: any | null;
  error?: string;
}> {
  try {
    console.log(`[MELI] GET /items/${itemId}`);
    const res = await fetch(`${MELI_BASE}/items/${itemId}`);
    const data = await res.json() as any;

    if (!res.ok) {
      throw new Error(data.message || "Item not found");
    }

    return { source: "mercadolibre", product: data };
  } catch (err) {
    return {
      source: "mercadolibre",
      product: null,
      error: err instanceof Error ? err.message : "Failed to get product details",
    };
  }
}

// ─── Format for Telegram ─────────────────────────────

export function formatMeliResults(results: MeliProduct[]): string {
  if (results.length === 0) {
    return "Não encontrei produtos com esses critérios no Mercado Livre.";
  }

  const formatPrice = (price: number, currency: string) => {
    if (currency === 'BRL') return `R$ ${price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (currency === 'ARS') return `ARS $${price.toLocaleString('es-AR')}`;
    if (currency === 'MXN') return `MX$${price.toLocaleString('es-MX')}`;
    return `${currency} ${price.toFixed(2)}`;
  };

  const items = results.slice(0, 5).map((p, i) => {
    const parts = [
      `${i + 1}. 🛒 ${p.title}`,
      `   💰 ${formatPrice(p.price, p.currency)}`,
      `   📦 ${p.condition}${p.freeShipping ? ' · 🚚 Frete grátis' : ''}`,
      `   🏪 ${p.sellerName}`,
    ];
    return parts.join("\n");
  });

  return items.join("\n\n") + "\n\nQuer mais detalhes de algum? Me diga o número.";
}
