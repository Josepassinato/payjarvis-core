/**
 * Publix Service
 *
 * Publix has NO public API. All data is retrieved via browser-agent
 * scraping (Layer 4). The browser-agent handles session management,
 * rate limiting, and HTML parsing.
 */

const BROWSER_AGENT_URL = "http://localhost:3003/api/scrape";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PublixStore {
  storeId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number;
  lng: number;
  hasPharmacy: boolean;
  hasDeli: boolean;
  hasFloral: boolean;
  hours: string;
}

export interface PublixProduct {
  name: string;
  price: number;
  unitPrice: string;
  onSale: boolean;
  isBOGO: boolean;
  savings: number;
  imageUrl: string;
  storeUrl: string;
}

export interface PublixDeal {
  title: string;
  regularPrice: number;
  salePrice: number;
  savings: number;
  isBOGO: boolean;
  validThrough: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function browserAgent<T>(
  action: string,
  params: Record<string, unknown>
): Promise<T> {
  const res = await fetch(BROWSER_AGENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site: "publix", action, params }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(
      `Browser-agent error (publix/${action}): ${res.status} ${res.statusText}`
    );
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseStore(raw: any): PublixStore {
  return {
    storeId: raw?.storeId?.toString() ?? raw?.store_id?.toString() ?? "",
    name: raw?.name ?? raw?.storeName ?? "",
    address: raw?.address ?? raw?.streetAddress ?? "",
    city: raw?.city ?? "",
    state: raw?.state ?? "",
    zip: raw?.zip ?? raw?.postalCode ?? "",
    phone: raw?.phone ?? raw?.phoneNumber ?? "",
    lat: raw?.lat ?? raw?.latitude ?? 0,
    lng: raw?.lng ?? raw?.longitude ?? 0,
    hasPharmacy: raw?.hasPharmacy ?? raw?.pharmacy ?? false,
    hasDeli: raw?.hasDeli ?? raw?.deli ?? false,
    hasFloral: raw?.hasFloral ?? raw?.floral ?? false,
    hours: raw?.hours ?? raw?.storeHours ?? "",
  };
}

function parseProduct(raw: any): PublixProduct {
  const regularPrice = raw?.regularPrice ?? raw?.price ?? 0;
  const salePrice = raw?.salePrice ?? raw?.price ?? regularPrice;
  const isBOGO =
    raw?.isBOGO ??
    raw?.promotion?.toLowerCase?.()?.includes("bogo") ??
    false;

  return {
    name: raw?.name ?? raw?.title ?? "",
    price: salePrice,
    unitPrice: raw?.unitPrice ?? raw?.unit_price ?? "",
    onSale: raw?.onSale ?? salePrice < regularPrice,
    isBOGO,
    savings: raw?.savings ?? Math.max(0, regularPrice - salePrice),
    imageUrl: raw?.imageUrl ?? raw?.image_url ?? "",
    storeUrl: raw?.storeUrl ?? raw?.url ?? "",
  };
}

function parseDeal(raw: any): PublixDeal {
  const regularPrice = raw?.regularPrice ?? raw?.regular_price ?? 0;
  const salePrice = raw?.salePrice ?? raw?.sale_price ?? 0;

  return {
    title: raw?.title ?? raw?.name ?? "",
    regularPrice,
    salePrice,
    savings: raw?.savings ?? Math.max(0, regularPrice - salePrice),
    isBOGO:
      raw?.isBOGO ??
      raw?.promotion?.toLowerCase?.()?.includes("bogo") ??
      false,
    validThrough: raw?.validThrough ?? raw?.valid_through ?? "",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Always true — Publix uses browser-agent only, no API keys required. */
export function isConfigured(): boolean {
  return true;
}

export async function findStores(
  zipCode: string,
  radius: number = 25
): Promise<PublixStore[]> {
  try {
    const data = await browserAgent<any[]>("findStores", {
      zipCode,
      radius,
    });
    return (data ?? []).map(parseStore);
  } catch (err) {
    console.error("[publix] findStores failed:", err);
    return [];
  }
}

export async function searchProducts(
  query: string,
  storeId?: string
): Promise<PublixProduct[]> {
  try {
    const data = await browserAgent<any[]>("searchProducts", {
      query,
      storeId,
    });
    return (data ?? []).map(parseProduct);
  } catch (err) {
    console.error("[publix] searchProducts failed:", err);
    return [];
  }
}

export async function getWeeklyAd(
  storeId: string
): Promise<PublixDeal[]> {
  try {
    const data = await browserAgent<any[]>("getWeeklyAd", { storeId });
    return (data ?? []).map(parseDeal);
  } catch (err) {
    console.error("[publix] getWeeklyAd failed:", err);
    return [];
  }
}

export async function getBOGODeals(
  storeId: string
): Promise<PublixDeal[]> {
  try {
    const data = await browserAgent<any[]>("getBOGODeals", { storeId });
    return (data ?? []).map(parseDeal);
  } catch (err) {
    console.error("[publix] getBOGODeals failed:", err);
    return [];
  }
}
