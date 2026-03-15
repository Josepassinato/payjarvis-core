/**
 * Target Retail Client
 *
 * Uses Target's Redsky API (semi-public, no auth needed) with CJ Affiliate tracking.
 * Falls back to browser-agent scraping when API is unavailable.
 *
 * Optional env vars:
 *  - TARGET_AFFILIATE_ID (for CJ Affiliate tracking links)
 */

const BROWSER_AGENT_URL = "http://localhost:3003/api/scrape";
const TARGET_API_BASE = "https://redsky.target.com/redsky_aggregations/v1";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TargetProduct {
  tcin: string;
  title: string;
  price: number;
  regularPrice: number;
  salePrice: number | null;
  brand: string;
  imageUrl: string;
  productUrl: string;
  inStock: boolean;
  sameDay: boolean;
  driveUp: boolean;
  orderPickup: boolean;
}

export interface TargetStore {
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
  hasStarbucks: boolean;
  hasPharmacy: boolean;
  hasCVS: boolean;
  hasOptical: boolean;
}

export interface TargetDeal {
  title: string;
  regularPrice: number;
  salePrice: number;
  savings: number;
  percentOff: number;
  imageUrl: string;
  productUrl: string;
  validThrough: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAffiliateId(): string {
  return process.env.TARGET_AFFILIATE_ID ?? "";
}

/** Append CJ Affiliate ref tag to a Target product URL. */
function affiliateUrl(rawUrl: string): string {
  const affiliateId = getAffiliateId();
  if (!affiliateId) return rawUrl;

  try {
    const url = new URL(rawUrl);
    url.searchParams.set("ref", `cj_${affiliateId}`);
    url.searchParams.set("afid", affiliateId);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function browserAgentFallback<T>(
  action: string,
  params: Record<string, unknown>
): Promise<T> {
  const res = await fetch(BROWSER_AGENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site: "target", action, params }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`Browser-agent error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data as T;
}

async function apiRequest<T>(
  path: string,
  queryParams: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${TARGET_API_BASE}${path}`);
  url.searchParams.set("channel", "WEB");
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Target API returned ${res.status}`);
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseProduct(item: any): TargetProduct {
  const product = item?.item ?? item?.product ?? item;
  const pricing = product?.price ?? {};
  const fulfillment = product?.fulfillment ?? {};

  const rawUrl =
    product?.enrichment?.buy_url ??
    `https://www.target.com/p/-/A-${product?.tcin ?? ""}`;

  return {
    tcin: product?.tcin ?? "",
    title: product?.description?.title ?? product?.title ?? "",
    price:
      pricing?.formatted_current_price_default_message ??
      pricing?.current_retail ??
      pricing?.reg_retail ??
      0,
    regularPrice: pricing?.reg_retail ?? 0,
    salePrice: pricing?.current_retail !== pricing?.reg_retail
      ? pricing?.current_retail ?? null
      : null,
    brand:
      product?.description?.upstream_description ?? product?.brand ?? "",
    imageUrl: product?.enrichment?.images?.primary_image_url ?? "",
    productUrl: affiliateUrl(rawUrl),
    inStock: fulfillment?.is_out_of_stock_in_all_store_locations !== true,
    sameDay: fulfillment?.shipping_options?.availability_status === "IN_STOCK",
    driveUp: fulfillment?.store_options?.some(
      (o: any) => o.order_pickup?.availability_status === "IN_STOCK" && o.drive_up
    ) ?? false,
    orderPickup: fulfillment?.store_options?.some(
      (o: any) => o.order_pickup?.availability_status === "IN_STOCK"
    ) ?? false,
  };
}

function parseStore(raw: any): TargetStore {
  return {
    storeId: raw?.location_id?.toString() ?? raw?.storeId ?? "",
    name: raw?.location_name ?? raw?.name ?? "",
    address: raw?.address?.address_line1 ?? raw?.address ?? "",
    city: raw?.address?.city ?? raw?.city ?? "",
    state: raw?.address?.state ?? raw?.state ?? "",
    zip: raw?.address?.postal_code ?? raw?.zip ?? "",
    phone: raw?.contact_information?.telephone ?? raw?.phone ?? "",
    lat: raw?.geographic_specifications?.latitude ?? raw?.lat ?? 0,
    lng: raw?.geographic_specifications?.longitude ?? raw?.lng ?? 0,
    hours: raw?.rolling_operating_hours?.regular_event_hours?.days?.[0]?.hours ?? raw?.hours ?? "",
    hasStarbucks: raw?.capabilities?.some((c: any) => c.capability_code === "Starbucks") ?? false,
    hasPharmacy: raw?.capabilities?.some((c: any) => c.capability_code === "Pharmacy") ?? false,
    hasCVS: raw?.capabilities?.some((c: any) => c.capability_code === "CVS pharmacy") ?? false,
    hasOptical: raw?.capabilities?.some((c: any) => c.capability_code === "Optical") ?? false,
  };
}

function parseDeal(raw: any): TargetDeal {
  const rawUrl =
    raw?.product_url ?? raw?.productUrl ?? "https://www.target.com";

  return {
    title: raw?.title ?? raw?.name ?? "",
    regularPrice: raw?.regular_price ?? raw?.regularPrice ?? 0,
    salePrice: raw?.sale_price ?? raw?.salePrice ?? 0,
    savings: raw?.savings ?? 0,
    percentOff: raw?.percent_off ?? raw?.percentOff ?? 0,
    imageUrl: raw?.image_url ?? raw?.imageUrl ?? "",
    productUrl: affiliateUrl(rawUrl),
    validThrough: raw?.valid_through ?? raw?.validThrough ?? "",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Always true — Redsky API is semi-public and needs no key. */
export function isConfigured(): boolean {
  return true;
}

export async function searchProducts(
  query: string,
  storeId?: string,
  zipCode?: string
): Promise<TargetProduct[]> {
  try {
    const params: Record<string, string> = {
      keyword: query,
      count: "10",
      offset: "0",
      page: `/s/${query}`,
      default_purchasability_filter: "true",
    };
    if (storeId) params.pricing_store_id = storeId;
    if (zipCode) params.zip = zipCode;

    const data = await apiRequest<any>(
      "/web/plp_search_v2",
      params
    );

    const items =
      data?.data?.search?.products ?? data?.data?.results ?? [];
    return items.map(parseProduct);
  } catch {
    // Fallback to browser-agent
    const data = await browserAgentFallback<any[]>("searchProducts", {
      query,
      storeId,
      zipCode,
    });
    return (data ?? []).map(parseProduct);
  }
}

export async function getProduct(
  tcin: string
): Promise<TargetProduct | null> {
  try {
    const data = await apiRequest<any>(
      "/web/pdp_client_v1",
      { tcin, pricing_store_id: "" }
    );

    const product = data?.data?.product;
    if (!product) return null;
    return parseProduct(product);
  } catch {
    try {
      const data = await browserAgentFallback<any>("getProduct", { tcin });
      return data ? parseProduct(data) : null;
    } catch {
      return null;
    }
  }
}

export async function checkStoreAvailability(
  tcin: string,
  storeId: string
): Promise<{ available: boolean; driveUp: boolean; orderPickup: boolean }> {
  try {
    const data = await apiRequest<any>(
      "/web/pdp_fulfillment_v1",
      { tcin, store_id: storeId }
    );

    const fulfillment = data?.data?.product?.fulfillment ?? {};
    const storeOptions = fulfillment?.store_options ?? [];
    const pickup = storeOptions.find(
      (o: any) => o.location_id?.toString() === storeId
    );

    return {
      available:
        pickup?.order_pickup?.availability_status === "IN_STOCK" ||
        pickup?.in_store_only?.availability_status === "IN_STOCK",
      driveUp: pickup?.drive_up?.availability_status === "IN_STOCK",
      orderPickup:
        pickup?.order_pickup?.availability_status === "IN_STOCK",
    };
  } catch {
    try {
      return await browserAgentFallback<{
        available: boolean;
        driveUp: boolean;
        orderPickup: boolean;
      }>("checkStoreAvailability", { tcin, storeId });
    } catch {
      return { available: false, driveUp: false, orderPickup: false };
    }
  }
}

export async function findStores(
  zipCode: string,
  radius: number = 25
): Promise<TargetStore[]> {
  try {
    const data = await apiRequest<any>(
      "/web/store_location_v1",
      {
        place: zipCode,
        within: radius.toString(),
        limit: "5",
      }
    );

    const locations = data?.data?.locations ?? data?.locations ?? [];
    return locations.map(parseStore);
  } catch {
    const data = await browserAgentFallback<any[]>("findStores", {
      zipCode,
      radius,
    });
    return (data ?? []).map(parseStore);
  }
}

export async function getCircularDeals(
  storeId: string
): Promise<TargetDeal[]> {
  // Circular deals are not available via the standard API — always use browser-agent
  try {
    const data = await browserAgentFallback<any[]>("getCircularDeals", {
      storeId,
    });
    return (data ?? []).map(parseDeal);
  } catch {
    return [];
  }
}
