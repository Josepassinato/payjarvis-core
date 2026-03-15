/**
 * CVS Pharmacy Client
 *
 * CVS has no public consumer API — all interactions go through
 * browser-agent assisted endpoints (http://localhost:3003/api/scrape).
 * Requires CVS_API_KEY env var for any available endpoints.
 */

const BROWSER_AGENT_URL = "http://localhost:3003/api/scrape";

// ── Interfaces ──────────────────────────────────────────────

export interface CVSStore {
  storeId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number;
  lng: number;
  isOpen24H: boolean;
  hasPharmacy: boolean;
  hasMinuteClinic: boolean;
  pharmacyHours: string;
}

export interface RxStatus {
  rxNumber: string;
  status: string;
  readyDate: string;
  refillsRemaining: number;
  refillUrl: string;
}

export interface CVSProduct {
  name: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  inStock: boolean;
}

export interface CVSDeal {
  title: string;
  description: string;
  discount: string;
  validUntil: string;
  imageUrl?: string;
  productUrl?: string;
}

export interface Slot {
  time: string;
  available: boolean;
  provider?: string;
  serviceType?: string;
}

// ── Helpers ─────────────────────────────────────────────────

async function browserAgentRequest<T>(
  action: string,
  params: Record<string, unknown>
): Promise<T> {
  const res = await fetch(BROWSER_AGENT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.CVS_API_KEY
        ? { "X-Api-Key": process.env.CVS_API_KEY }
        : {}),
    },
    body: JSON.stringify({ site: "cvs", action, params }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `browser-agent CVS/${action} failed: ${res.status} ${body}`
    );
  }

  const data = (await res.json()) as { result: T };
  return data.result;
}

// ── Public API ──────────────────────────────────────────────

export function isConfigured(): boolean {
  return !!process.env.CVS_API_KEY;
}

/**
 * Find CVS stores near a zip code.
 */
export async function findStores(
  zipCode: string,
  radius = 10
): Promise<CVSStore[]> {
  try {
    return await browserAgentRequest<CVSStore[]>("findStores", {
      zipCode,
      radius,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[cvs-client] findStores failed: ${msg}`);
    return [];
  }
}

/**
 * Check prescription status via browser-agent scraping.
 */
export async function checkPrescriptionStatus(
  rxNumber: string,
  dateOfBirth: string
): Promise<RxStatus> {
  return browserAgentRequest<RxStatus>("checkPrescriptionStatus", {
    rxNumber,
    dateOfBirth,
  });
}

/**
 * Get MinuteClinic availability for a given store and date.
 */
export async function getMinuteClinicAvailability(
  storeId: string,
  date: string
): Promise<Slot[]> {
  try {
    return await browserAgentRequest<Slot[]>("getMinuteClinicAvailability", {
      storeId,
      date,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[cvs-client] getMinuteClinicAvailability failed: ${msg}`);
    return [];
  }
}

/**
 * Search over-the-counter products at CVS.
 */
export async function searchOTC(
  query: string,
  storeId?: string
): Promise<CVSProduct[]> {
  try {
    return await browserAgentRequest<CVSProduct[]>("searchOTC", {
      query,
      ...(storeId ? { storeId } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[cvs-client] searchOTC failed: ${msg}`);
    return [];
  }
}

/**
 * Get weekly ad / deals for a specific CVS store.
 */
export async function getWeeklyAd(storeId: string): Promise<CVSDeal[]> {
  try {
    return await browserAgentRequest<CVSDeal[]>("getWeeklyAd", { storeId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[cvs-client] getWeeklyAd failed: ${msg}`);
    return [];
  }
}
