/**
 * Walgreens Pharmacy Client
 *
 * Uses the Walgreens affiliate/partner API (partial public access).
 * Requires WALGREENS_APP_ID and WALGREENS_APP_KEY env vars.
 * Base URL: https://api.walgreens.com/v1
 */

const WALGREENS_BASE = "https://api.walgreens.com/v1";

// ── Interfaces ──────────────────────────────────────────────

export interface WalgreensStore {
  storeId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number;
  lng: number;
  isOpen24H: boolean;
  hasPharmacy: boolean;
  hasDriveThru: boolean;
  hasImmunizations: boolean;
  pharmacyHours: string;
  storeHours: string;
}

export interface WalgreensProduct {
  productId: string;
  name: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  inStock: boolean;
}

export interface WalgreensDeal {
  dealId: string;
  title: string;
  description: string;
  discount: string;
  validFrom: string;
  validUntil: string;
  imageUrl?: string;
}

export interface RxReady {
  rxNumber: string;
  status: string;
  readyDate?: string;
  storeName?: string;
  storeAddress?: string;
}

export interface ImmunizationSlot {
  slotId: string;
  vaccine: string;
  date: string;
  time: string;
  storeId: string;
  storeName: string;
  available: boolean;
}

// ── Helpers ─────────────────────────────────────────────────

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    apikey: process.env.WALGREENS_APP_KEY ?? "",
    appid: process.env.WALGREENS_APP_ID ?? "",
  };
}

async function walgreensGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${WALGREENS_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: getHeaders(),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Walgreens GET ${path} failed: ${res.status} ${body}`);
  }

  return (await res.json()) as T;
}

async function walgreensPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${WALGREENS_BASE}${path}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Walgreens POST ${path} failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

// ── Public API ──────────────────────────────────────────────

export function isConfigured(): boolean {
  return !!(process.env.WALGREENS_APP_ID && process.env.WALGREENS_APP_KEY);
}

/**
 * Find Walgreens stores near a lat/lng coordinate.
 */
export async function findStores(
  lat: number,
  lng: number,
  radius = 10
): Promise<WalgreensStore[]> {
  if (!isConfigured()) return [];

  try {
    const data = await walgreensPost<{ results: WalgreensStore[] }>(
      "/stores/search",
      {
        lat: String(lat),
        lng: String(lng),
        radius: String(radius),
      }
    );
    return data.results ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[walgreens-client] findStores failed: ${msg}`);
    return [];
  }
}

/**
 * Search products in the Walgreens catalog.
 */
export async function searchProducts(
  query: string,
  storeId?: string
): Promise<WalgreensProduct[]> {
  if (!isConfigured()) return [];

  try {
    const params: Record<string, string> = { q: query };
    if (storeId) params.storeId = storeId;

    const data = await walgreensGet<{ products: WalgreensProduct[] }>(
      "/products/search",
      params
    );
    return data.products ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[walgreens-client] searchProducts failed: ${msg}`);
    return [];
  }
}

/**
 * Get available photo services for a store.
 */
export async function getPhotoServices(storeId: string): Promise<any> {
  if (!isConfigured()) return {};

  try {
    return await walgreensGet(`/stores/${storeId}/photo-services`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[walgreens-client] getPhotoServices failed: ${msg}`);
    return {};
  }
}

/**
 * Check if a prescription is ready for pickup.
 */
export async function checkPrescriptionReady(
  rxNumber: string,
  lastName: string
): Promise<RxReady> {
  if (!isConfigured()) {
    return {
      rxNumber,
      status: "unconfigured",
    };
  }

  try {
    return await walgreensPost<RxReady>("/pharmacy/rx/status", {
      rxNumber,
      lastName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[walgreens-client] checkPrescriptionReady failed: ${msg}`);
    return { rxNumber, status: "error" };
  }
}

/**
 * Get current deals and coupons, optionally filtered by store.
 */
export async function getDealsAndCoupons(
  storeId?: string
): Promise<WalgreensDeal[]> {
  if (!isConfigured()) return [];

  try {
    const params: Record<string, string> = {};
    if (storeId) params.storeId = storeId;

    const data = await walgreensGet<{ deals: WalgreensDeal[] }>(
      "/deals",
      params
    );
    return data.deals ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[walgreens-client] getDealsAndCoupons failed: ${msg}`);
    return [];
  }
}

/**
 * Get available immunization appointment slots.
 */
export async function bookImmunization(
  vaccine: string,
  storeId: string,
  date: string
): Promise<ImmunizationSlot[]> {
  if (!isConfigured()) return [];

  try {
    const data = await walgreensPost<{ slots: ImmunizationSlot[] }>(
      "/pharmacy/immunizations/availability",
      { vaccine, storeId, date }
    );
    return data.slots ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[walgreens-client] bookImmunization failed: ${msg}`);
    return [];
  }
}
