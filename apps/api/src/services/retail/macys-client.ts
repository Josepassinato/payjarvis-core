/**
 * Macy's Retail Client
 *
 * Uses Macy's affiliate API for product search, store lookup, and sales.
 * Falls back to browser-agent scraping when API is unavailable.
 * Requires MACYS_API_KEY and MACYS_AFFILIATE_ID env vars.
 */

const BROWSER_AGENT_URL = "http://localhost:3003/api/scrape";
const MACYS_API_BASE = "https://api.macys.com/v4";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface MacysProduct {
  id: string;
  name: string;
  brand: string;
  regularPrice: number;
  salePrice: number | null;
  discount: number;
  colors: string[];
  sizes: string[];
  imageUrl: string;
  productUrl: string;
  isOnSale: boolean;
  rating: number;
}

export interface MacysStore {
  storeId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number;
  lng: number;
  hours: string;
}

export interface MacysSale {
  id: string;
  title: string;
  description: string;
  discountPercent: number;
  category: string;
  startDate: string;
  endDate: string;
  promoCode: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  return process.env.MACYS_API_KEY ?? "";
}

function getAffiliateId(): string {
  return process.env.MACYS_AFFILIATE_ID ?? "";
}

/** Append affiliate tracking parameters to a Macy's product URL. */
function affiliateUrl(rawUrl: string): string {
  const affiliateId = getAffiliateId();
  if (!affiliateId) return rawUrl;

  try {
    const url = new URL(rawUrl);
    url.searchParams.set("cm_mmc", `affiliate-_-${affiliateId}`);
    url.searchParams.set("aid", affiliateId);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function apiRequest<T>(
  path: string,
  queryParams: Record<string, string> = {}
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("MACYS_API_KEY not configured");
  }

  const url = new URL(`${MACYS_API_BASE}${path}`);
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Macys-Webservice-Client-Id": apiKey,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Macy's API returned ${res.status}`);
  }

  return (await res.json()) as T;
}

async function browserAgentFallback<T>(
  action: string,
  params: Record<string, unknown>
): Promise<T> {
  const res = await fetch(BROWSER_AGENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site: "macys", action, params }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(
      `Browser-agent error (macys/${action}): ${res.status} ${res.statusText}`
    );
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseProduct(raw: any): MacysProduct {
  const regularPrice =
    raw?.pricing?.regular?.value ??
    raw?.regularPrice ??
    raw?.price?.regular ??
    0;
  const salePrice =
    raw?.pricing?.sale?.value ??
    raw?.salePrice ??
    raw?.price?.sale ??
    null;
  const isOnSale =
    raw?.isOnSale ?? (salePrice !== null && salePrice < regularPrice);

  const rawUrl =
    raw?.productURL ??
    raw?.productUrl ??
    raw?.url ??
    `https://www.macys.com/shop/product?ID=${raw?.id ?? ""}`;

  return {
    id: raw?.id?.toString() ?? raw?.productId?.toString() ?? "",
    name: raw?.name ?? raw?.productName ?? raw?.summary?.name ?? "",
    brand: raw?.brand?.name ?? raw?.brand ?? "",
    regularPrice,
    salePrice,
    discount: isOnSale && salePrice !== null
      ? Math.round(((regularPrice - salePrice) / regularPrice) * 100)
      : 0,
    colors: raw?.colors?.map((c: any) => c?.name ?? c) ?? raw?.colorways ?? [],
    sizes: raw?.sizes?.map((s: any) => s?.name ?? s) ?? raw?.availableSizes ?? [],
    imageUrl:
      raw?.imagery?.images?.[0]?.filePath ??
      raw?.imageUrl ??
      raw?.image ??
      "",
    productUrl: affiliateUrl(rawUrl),
    isOnSale,
    rating: raw?.reviews?.averageRating ?? raw?.rating ?? 0,
  };
}

function parseStore(raw: any): MacysStore {
  return {
    storeId: raw?.id?.toString() ?? raw?.storeId?.toString() ?? "",
    name: raw?.name ?? raw?.storeName ?? "",
    address: raw?.address?.line1 ?? raw?.address ?? "",
    city: raw?.address?.city ?? raw?.city ?? "",
    state: raw?.address?.state ?? raw?.state ?? "",
    zip: raw?.address?.zipCode ?? raw?.zip ?? "",
    phone: raw?.phone ?? raw?.phoneNumber ?? "",
    lat: raw?.coordinates?.latitude ?? raw?.lat ?? 0,
    lng: raw?.coordinates?.longitude ?? raw?.lng ?? 0,
    hours: raw?.hours?.summary ?? raw?.hours ?? "",
  };
}

function parseSale(raw: any): MacysSale {
  return {
    id: raw?.id?.toString() ?? "",
    title: raw?.title ?? raw?.name ?? "",
    description: raw?.description ?? raw?.details ?? "",
    discountPercent: raw?.discountPercent ?? raw?.discount ?? 0,
    category: raw?.category ?? raw?.department ?? "",
    startDate: raw?.startDate ?? raw?.start_date ?? "",
    endDate: raw?.endDate ?? raw?.end_date ?? "",
    promoCode: raw?.promoCode ?? raw?.promo_code ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isConfigured(): boolean {
  return !!(process.env.MACYS_API_KEY && process.env.MACYS_AFFILIATE_ID);
}

export async function searchProducts(
  query: string,
  category?: string,
  brand?: string,
  priceMin?: number,
  priceMax?: number
): Promise<MacysProduct[]> {
  try {
    const params: Record<string, string> = {
      keyword: query,
      perPage: "24",
    };
    if (category) params.category = category;
    if (brand) params.brand = brand;
    if (priceMin !== undefined) params.priceMin = priceMin.toString();
    if (priceMax !== undefined) params.priceMax = priceMax.toString();

    const data = await apiRequest<any>("/catalog/search", params);

    const products =
      data?.searchresultgroups?.[0]?.products?.product ??
      data?.products ??
      [];
    return products.map(parseProduct);
  } catch {
    try {
      const data = await browserAgentFallback<any[]>("searchProducts", {
        query,
        category,
        brand,
        priceMin,
        priceMax,
      });
      return (data ?? []).map(parseProduct);
    } catch {
      return [];
    }
  }
}

export async function getProduct(
  productId: string
): Promise<MacysProduct | null> {
  try {
    const data = await apiRequest<any>("/catalog/product", {
      productId,
    });

    const product = data?.product ?? data;
    if (!product?.id && !product?.productId) return null;
    return parseProduct(product);
  } catch {
    try {
      const data = await browserAgentFallback<any>("getProduct", {
        productId,
      });
      return data ? parseProduct(data) : null;
    } catch {
      return null;
    }
  }
}

export async function findStores(
  zipCode: string
): Promise<MacysStore[]> {
  try {
    const data = await apiRequest<any>("/store/search", {
      searchAddress: zipCode,
      radius: "50",
    });

    const stores = data?.stores ?? data?.storeList ?? [];
    return stores.map(parseStore);
  } catch {
    try {
      const data = await browserAgentFallback<any[]>("findStores", {
        zipCode,
      });
      return (data ?? []).map(parseStore);
    } catch {
      return [];
    }
  }
}

export async function getSales(): Promise<MacysSale[]> {
  // Sales/promotions are typically not exposed via the catalog API —
  // prefer browser-agent scraping, fall back to API if available.
  try {
    const data = await browserAgentFallback<any[]>("getSales", {});
    return (data ?? []).map(parseSale);
  } catch {
    try {
      const data = await apiRequest<any>("/promotions/active");
      const sales = data?.promotions ?? [];
      return sales.map(parseSale);
    } catch {
      return [];
    }
  }
}
