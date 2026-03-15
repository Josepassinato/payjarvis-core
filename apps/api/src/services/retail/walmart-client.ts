/**
 * Walmart Open API Client
 *
 * Provides access to Walmart product search, store lookup, availability,
 * trending items, and deals via the Walmart Open API.
 *
 * Requires env vars:
 *  - WALMART_CONSUMER_ID
 *  - WALMART_PRIVATE_KEY (RSA PEM for request signing)
 *  - WALMART_CHANNEL_TYPE (optional, defaults to empty)
 *  - WALMART_AFFILIATE_ID (optional, appended to product URLs)
 */

import { createSign } from "node:crypto";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface WalmartProduct {
  itemId: number;
  name: string;
  salePrice: number;
  msrp: number;
  categoryPath: string;
  thumbnailImage: string;
  productUrl: string;
  inStock: boolean;
  availableOnline: boolean;
  availableInStore: boolean;
  freeShippingOver35: boolean;
  pickupToday: boolean;
}

export interface WalmartStore {
  storeId: number;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number;
  lng: number;
  openHours: string;
  pharmacyHours: string;
  autoHours: string;
  isOpen24Hours: boolean;
}

export interface StoreAvailability {
  itemId: number;
  storeId: number;
  storeName: string;
  inStock: boolean;
  price: number;
  pickupToday: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WALMART_BASE = "https://developer.api.walmart.com";
const REQUEST_TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function getConsumerId(): string {
  const id = process.env.WALMART_CONSUMER_ID;
  if (!id) throw new Error("WALMART_CONSUMER_ID is not set");
  return id;
}

function getPrivateKey(): string {
  const key = process.env.WALMART_PRIVATE_KEY;
  if (!key) throw new Error("WALMART_PRIVATE_KEY is not set");
  return key;
}

/**
 * Generate the WM_SEC.AUTH_SIGNATURE header value.
 * Walmart requires an RSA-SHA256 signature of the concatenated
 * consumerId + timestamp + keyVersion string.
 */
function generateSignature(
  consumerId: string,
  privateKey: string,
  timestamp: number,
  keyVersion: string = "1"
): string {
  const data = `${consumerId}\n${timestamp}\n${keyVersion}\n`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, "base64");
}

/**
 * Build the required auth headers for every Walmart API request.
 */
function buildHeaders(): Record<string, string> {
  const consumerId = getConsumerId();
  const privateKey = getPrivateKey();
  const timestamp = Date.now();
  const keyVersion = "1";
  const signature = generateSignature(
    consumerId,
    privateKey,
    timestamp,
    keyVersion
  );

  const headers: Record<string, string> = {
    "WM_CONSUMER.ID": consumerId,
    "WM_CONSUMER.INTIMESTAMP": String(timestamp),
    "WM_SEC.AUTH_SIGNATURE": signature,
    "WM_SEC.KEY_VERSION": keyVersion,
    Accept: "application/json",
  };

  const channelType = process.env.WALMART_CHANNEL_TYPE;
  if (channelType) {
    headers["WM_CONSUMER.CHANNEL.TYPE"] = channelType;
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appendAffiliateTag(url: string): string {
  const affiliateId = process.env.WALMART_AFFILIATE_ID;
  if (!affiliateId || !url) return url;

  try {
    const u = new URL(url);
    u.searchParams.set("affiliates", affiliateId);
    return u.toString();
  } catch {
    // If the URL is malformed, return with simple concatenation
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}affiliates=${affiliateId}`;
  }
}

function mapProduct(raw: Record<string, unknown>): WalmartProduct {
  return {
    itemId: Number(raw.itemId ?? 0),
    name: String(raw.name ?? ""),
    salePrice: Number(raw.salePrice ?? 0),
    msrp: Number(raw.msrp ?? raw.salePrice ?? 0),
    categoryPath: String(raw.categoryPath ?? ""),
    thumbnailImage: String(raw.thumbnailImage ?? ""),
    productUrl: appendAffiliateTag(
      String(raw.productUrl ?? raw.addToCartUrl ?? "")
    ),
    inStock: Boolean(raw.stock === "Available" || raw.inStock),
    availableOnline: Boolean(raw.availableOnline),
    availableInStore: Boolean(raw.availableInStore ?? raw.inStore),
    freeShippingOver35: Boolean(raw.freeShippingOver35 ?? raw.freeShipToStore),
    pickupToday: Boolean(raw.pickupToday),
  };
}

function mapStore(raw: Record<string, unknown>): WalmartStore {
  return {
    storeId: Number(raw.no ?? raw.storeId ?? 0),
    name: String(raw.name ?? raw.storeName ?? ""),
    address: String(raw.streetAddress ?? raw.address ?? ""),
    city: String(raw.city ?? ""),
    state: String(raw.stateProvCode ?? raw.state ?? ""),
    zip: String(raw.zip ?? raw.postalCode ?? ""),
    phone: String(raw.phoneNumber ?? raw.phone ?? ""),
    lat: Number((raw.coordinates as any)?.lat ?? raw.latitude ?? raw.lat ?? 0),
    lng: Number((raw.coordinates as any)?.lng ?? raw.longitude ?? raw.lng ?? 0),
    openHours: String(
      (raw as any)?.operationalHours?.open ?? raw.openHours ?? ""
    ),
    pharmacyHours: String(
      (raw as any)?.pharmacyHours?.open ?? raw.pharmacyHours ?? ""
    ),
    autoHours: String(
      (raw as any)?.autoCareHours?.open ?? raw.autoHours ?? ""
    ),
    isOpen24Hours: Boolean(raw.open24Hours ?? raw.isOpen24Hours ?? false),
  };
}

async function walmartFetch(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const url = new URL(path, WALMART_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`Walmart API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if required Walmart env vars are set.
 */
export function isConfigured(): boolean {
  return !!(process.env.WALMART_CONSUMER_ID && process.env.WALMART_PRIVATE_KEY);
}

/**
 * Search products by keyword.
 */
export async function searchProducts(
  query: string,
  categoryId?: string,
  numItems: number = 25,
  start: number = 1
): Promise<WalmartProduct[]> {
  if (!isConfigured()) return [];

  try {
    const params: Record<string, string> = {
      query,
      numItems: String(numItems),
      start: String(start),
      format: "json",
    };
    if (categoryId) params.categoryId = categoryId;

    const data = (await walmartFetch("/v1/search", params)) as any;
    const items: unknown[] = data?.items ?? [];
    return items.map((i) => mapProduct(i as Record<string, unknown>));
  } catch (err) {
    console.error(
      "[walmart] searchProducts error:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Get a single product by item ID.
 */
export async function getProduct(
  itemId: number
): Promise<WalmartProduct | null> {
  if (!isConfigured()) return null;

  try {
    const data = (await walmartFetch(`/v1/items/${itemId}`, {
      format: "json",
    })) as Record<string, unknown>;
    return mapProduct(data);
  } catch (err) {
    console.error(
      "[walmart] getProduct error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Check in-store availability for a product near a zip code.
 */
export async function checkAvailability(
  itemId: number,
  zipCode: string
): Promise<StoreAvailability | null> {
  if (!isConfigured()) return null;

  try {
    const data = (await walmartFetch(`/v1/items/${itemId}/availability`, {
      zipCode,
      format: "json",
    })) as any;

    return {
      itemId,
      storeId: Number(data?.storeId ?? 0),
      storeName: String(data?.storeName ?? ""),
      inStock: Boolean(data?.inStock ?? data?.available),
      price: Number(data?.price?.amount ?? data?.price ?? 0),
      pickupToday: Boolean(data?.pickupToday),
    };
  } catch (err) {
    console.error(
      "[walmart] checkAvailability error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Get nearby Walmart stores by coordinates.
 */
export async function getStores(
  lat: number,
  lng: number,
  radius: number = 50
): Promise<WalmartStore[]> {
  if (!isConfigured()) return [];

  try {
    const data = (await walmartFetch("/v1/stores", {
      lat: String(lat),
      lon: String(lng),
      radius: String(radius),
      format: "json",
    })) as any;

    const stores: unknown[] = data ?? [];
    return (Array.isArray(stores) ? stores : []).map((s) =>
      mapStore(s as Record<string, unknown>)
    );
  } catch (err) {
    console.error(
      "[walmart] getStores error:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Get trending items, optionally filtered by category.
 */
export async function getTrendingItems(
  categoryId?: string
): Promise<WalmartProduct[]> {
  if (!isConfigured()) return [];

  try {
    const params: Record<string, string> = { format: "json" };
    if (categoryId) params.categoryId = categoryId;

    const data = (await walmartFetch("/v1/trends", params)) as any;
    const items: unknown[] = data?.items ?? [];
    return items.map((i) => mapProduct(i as Record<string, unknown>));
  } catch (err) {
    console.error(
      "[walmart] getTrendingItems error:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Get current rollback/clearance deals.
 */
export async function getDeals(): Promise<WalmartProduct[]> {
  if (!isConfigured()) return [];

  try {
    const data = (await walmartFetch("/v1/feeds/specialbuys", {
      format: "json",
    })) as any;
    const items: unknown[] = data?.items ?? [];
    return items.map((i) => mapProduct(i as Record<string, unknown>));
  } catch (err) {
    console.error(
      "[walmart] getDeals error:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
