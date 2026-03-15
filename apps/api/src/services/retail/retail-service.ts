/**
 * Retail Service — Unified price comparison across all retail platforms
 *
 * Aggregates: Walmart, CVS, Walgreens, Amazon, Target, Publix, Macy's
 * Methods:
 *  - comparePrice: search selected platforms in parallel, sorted by price
 *  - findNearestPharmacy: compare CVS vs Walgreens nearby
 *  - findNearestStores: find all retail stores near a zip
 *  - checkRxAcrossPlatforms: check prescription status at CVS + Walgreens
 *  - findBestDeal: compare all retailers for best price
 */

import * as walmart from "./walmart-client.js";
import * as cvs from "../pharmacy/cvs-client.js";
import * as walgreens from "../pharmacy/walgreens-client.js";

// ── Interfaces ──────────────────────────────────────────────

export interface PriceComparison {
  platform: string;
  productName: string;
  price: number;
  url: string;
  inStock: boolean;
  savings?: number;
}

export interface StoreLocation {
  platform: string;
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
  hours?: string;
}

export interface RxCheckResult {
  platform: string;
  rxNumber: string;
  status: string;
  readyDate?: string;
  storeName?: string;
  error?: string;
}

// ── Constants ───────────────────────────────────────────────

const BROWSER_AGENT_URL = "http://localhost:3003/api/scrape";

const ALL_PLATFORMS = [
  "walmart",
  "cvs",
  "walgreens",
  "amazon",
  "target",
  "publix",
  "macys",
] as const;

export type RetailPlatform = (typeof ALL_PLATFORMS)[number];

// ── Browser Agent Helpers (for platforms without public APIs) ─

async function browserAgentSearch<T>(
  site: string,
  action: string,
  params: Record<string, unknown>
): Promise<T> {
  const res = await fetch(BROWSER_AGENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site, action, params }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`browser-agent ${site}/${action} failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { result: T };
  return data.result;
}

// ── Platform Search Implementations ─────────────────────────

async function searchWalmart(
  query: string,
  _zipCode: string
): Promise<PriceComparison[]> {
  try {
    const products = await walmart.searchProducts(query);
    return products.map((p) => ({
      platform: "walmart",
      productName: p.name,
      price: p.salePrice,
      url: p.productUrl,
      inStock: p.inStock,
      savings: p.msrp > p.salePrice ? +(p.msrp - p.salePrice).toFixed(2) : undefined,
    }));
  } catch (err) {
    console.error("[retail-service] Walmart search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchCVS(
  query: string,
  _zipCode: string
): Promise<PriceComparison[]> {
  try {
    const products = await cvs.searchOTC(query);
    return products.map((p) => ({
      platform: "cvs",
      productName: p.name,
      price: p.price,
      url: p.productUrl,
      inStock: p.inStock,
    }));
  } catch (err) {
    console.error("[retail-service] CVS search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchWalgreens(
  query: string,
  _zipCode: string
): Promise<PriceComparison[]> {
  try {
    const products = await walgreens.searchProducts(query);
    return products.map((p) => ({
      platform: "walgreens",
      productName: p.name,
      price: p.price,
      url: p.productUrl,
      inStock: p.inStock,
    }));
  } catch (err) {
    console.error("[retail-service] Walgreens search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchAmazon(
  query: string,
  _zipCode: string
): Promise<PriceComparison[]> {
  try {
    const results = await browserAgentSearch<
      Array<{ name: string; price: number; url: string; inStock: boolean; listPrice?: number }>
    >("amazon", "searchProducts", { query });

    return results.map((p) => ({
      platform: "amazon",
      productName: p.name,
      price: p.price,
      url: p.url,
      inStock: p.inStock,
      savings: p.listPrice && p.listPrice > p.price
        ? +(p.listPrice - p.price).toFixed(2)
        : undefined,
    }));
  } catch (err) {
    console.error("[retail-service] Amazon search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchTarget(
  query: string,
  zipCode: string
): Promise<PriceComparison[]> {
  try {
    const results = await browserAgentSearch<
      Array<{ name: string; price: number; url: string; inStock: boolean; comparePrice?: number }>
    >("target", "searchProducts", { query, zipCode });

    return results.map((p) => ({
      platform: "target",
      productName: p.name,
      price: p.price,
      url: p.url,
      inStock: p.inStock,
      savings: p.comparePrice && p.comparePrice > p.price
        ? +(p.comparePrice - p.price).toFixed(2)
        : undefined,
    }));
  } catch (err) {
    console.error("[retail-service] Target search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchPublix(
  query: string,
  zipCode: string
): Promise<PriceComparison[]> {
  try {
    const results = await browserAgentSearch<
      Array<{ name: string; price: number; url: string; inStock: boolean; bogo?: boolean }>
    >("publix", "searchProducts", { query, zipCode });

    return results.map((p) => ({
      platform: "publix",
      productName: p.name,
      price: p.price,
      url: p.url,
      inStock: p.inStock,
      savings: p.bogo ? +(p.price / 2).toFixed(2) : undefined,
    }));
  } catch (err) {
    console.error("[retail-service] Publix search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchMacys(
  query: string,
  _zipCode: string,
  options?: { category?: string; priceMin?: number; priceMax?: number }
): Promise<PriceComparison[]> {
  try {
    const results = await browserAgentSearch<
      Array<{ name: string; price: number; url: string; inStock: boolean; originalPrice?: number }>
    >("macys", "searchProducts", {
      query,
      ...(options?.category ? { category: options.category } : {}),
      ...(options?.priceMin ? { priceMin: options.priceMin } : {}),
      ...(options?.priceMax ? { priceMax: options.priceMax } : {}),
    });

    return results.map((p) => ({
      platform: "macys",
      productName: p.name,
      price: p.price,
      url: p.url,
      inStock: p.inStock,
      savings: p.originalPrice && p.originalPrice > p.price
        ? +(p.originalPrice - p.price).toFixed(2)
        : undefined,
    }));
  } catch (err) {
    console.error("[retail-service] Macys search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Platform dispatcher ─────────────────────────────────────

const PLATFORM_SEARCH: Record<
  RetailPlatform,
  (query: string, zipCode: string) => Promise<PriceComparison[]>
> = {
  walmart: searchWalmart,
  cvs: searchCVS,
  walgreens: searchWalgreens,
  amazon: searchAmazon,
  target: searchTarget,
  publix: searchPublix,
  macys: searchMacys,
};

// ── Public API ──────────────────────────────────────────────

/**
 * Search selected platforms in parallel and return results sorted by price.
 */
export async function comparePrice(
  query: string,
  zipCode: string,
  platforms?: RetailPlatform[]
): Promise<PriceComparison[]> {
  const selected = platforms?.length ? platforms : [...ALL_PLATFORMS];

  const searches = selected.map((platform) => {
    const searchFn = PLATFORM_SEARCH[platform];
    if (!searchFn) return Promise.resolve([]);
    return searchFn(query, zipCode).catch(() => [] as PriceComparison[]);
  });

  const results = await Promise.allSettled(searches);
  const allProducts: PriceComparison[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      allProducts.push(...r.value);
    }
  }

  return allProducts.sort((a, b) => a.price - b.price);
}

/**
 * Find nearest CVS and Walgreens pharmacies by coordinates.
 */
export async function findNearestPharmacy(
  lat: number,
  lng: number
): Promise<{ cvs: StoreLocation[]; walgreens: StoreLocation[] }> {
  const [cvsStores, walgStores] = await Promise.allSettled([
    cvs.findStores(String(Math.round(lat * 1000) / 1000)),
    walgreens.findStores(lat, lng),
  ]);

  const mapCvsStore = (s: cvs.CVSStore): StoreLocation => ({
    platform: "cvs",
    storeId: s.storeId,
    name: `CVS Pharmacy #${s.storeId}`,
    address: s.address,
    city: s.city,
    state: s.state,
    zip: s.zip,
    phone: s.phone,
    lat: s.lat,
    lng: s.lng,
    hasPharmacy: s.hasPharmacy,
    hours: s.pharmacyHours,
  });

  const mapWalgStore = (s: walgreens.WalgreensStore): StoreLocation => ({
    platform: "walgreens",
    storeId: s.storeId,
    name: s.name,
    address: s.address,
    city: s.city,
    state: s.state,
    zip: s.zip,
    phone: s.phone,
    lat: s.lat,
    lng: s.lng,
    hasPharmacy: s.hasPharmacy,
    hours: s.pharmacyHours,
  });

  return {
    cvs: cvsStores.status === "fulfilled" ? cvsStores.value.map(mapCvsStore) : [],
    walgreens: walgStores.status === "fulfilled" ? walgStores.value.map(mapWalgStore) : [],
  };
}

/**
 * Find all retail stores near a zip code (Walmart, Target, Publix, CVS, Walgreens).
 */
export async function findNearestStores(
  zipCode: string,
  radius = 25
): Promise<StoreLocation[]> {
  const [walmartStores, cvsStores, walgStores, targetStores, publixStores] =
    await Promise.allSettled([
      // Walmart uses lat/lng — approximate from zip via browser agent
      browserAgentSearch<Array<{ storeId: string; name: string; address: string; city: string; state: string; zip: string; phone: string; lat: number; lng: number }>>(
        "walmart", "findStores", { zipCode, radius }
      ),
      cvs.findStores(zipCode, radius),
      browserAgentSearch<Array<{ storeId: string; name: string; address: string; city: string; state: string; zip: string; phone: string; lat: number; lng: number }>>(
        "walgreens", "findStoresByZip", { zipCode, radius }
      ),
      browserAgentSearch<Array<{ storeId: string; name: string; address: string; city: string; state: string; zip: string; phone: string; lat: number; lng: number }>>(
        "target", "findStores", { zipCode, radius }
      ),
      browserAgentSearch<Array<{ storeId: string; name: string; address: string; city: string; state: string; zip: string; phone: string; lat: number; lng: number }>>(
        "publix", "findStores", { zipCode, radius }
      ),
    ]);

  const allStores: StoreLocation[] = [];

  const mapGeneric = (platform: string) => (s: any): StoreLocation => ({
    platform,
    storeId: String(s.storeId ?? ""),
    name: String(s.name ?? platform),
    address: String(s.address ?? ""),
    city: String(s.city ?? ""),
    state: String(s.state ?? ""),
    zip: String(s.zip ?? ""),
    phone: String(s.phone ?? ""),
    lat: Number(s.lat ?? 0),
    lng: Number(s.lng ?? 0),
    hasPharmacy: Boolean(s.hasPharmacy ?? false),
    hours: String(s.hours ?? s.storeHours ?? ""),
  });

  if (walmartStores.status === "fulfilled") {
    allStores.push(...walmartStores.value.map(mapGeneric("walmart")));
  }
  if (cvsStores.status === "fulfilled") {
    allStores.push(
      ...cvsStores.value.map((s) => ({
        platform: "cvs",
        storeId: s.storeId,
        name: `CVS Pharmacy #${s.storeId}`,
        address: s.address,
        city: s.city,
        state: s.state,
        zip: s.zip,
        phone: s.phone,
        lat: s.lat,
        lng: s.lng,
        hasPharmacy: s.hasPharmacy,
        hours: s.pharmacyHours,
      }))
    );
  }
  if (walgStores.status === "fulfilled") {
    allStores.push(...walgStores.value.map(mapGeneric("walgreens")));
  }
  if (targetStores.status === "fulfilled") {
    allStores.push(...targetStores.value.map(mapGeneric("target")));
  }
  if (publixStores.status === "fulfilled") {
    allStores.push(...publixStores.value.map(mapGeneric("publix")));
  }

  return allStores;
}

/**
 * Check prescription status across CVS and Walgreens.
 */
export async function checkRxAcrossPlatforms(
  rxNumber: string,
  patientInfo: { lastName?: string; dob?: string }
): Promise<RxCheckResult[]> {
  const results: RxCheckResult[] = [];

  const [cvsResult, walgResult] = await Promise.allSettled([
    patientInfo.dob
      ? cvs.checkPrescriptionStatus(rxNumber, patientInfo.dob)
      : Promise.reject(new Error("DOB required for CVS")),
    patientInfo.lastName
      ? walgreens.checkPrescriptionReady(rxNumber, patientInfo.lastName)
      : Promise.reject(new Error("Last name required for Walgreens")),
  ]);

  if (cvsResult.status === "fulfilled") {
    results.push({
      platform: "cvs",
      rxNumber: cvsResult.value.rxNumber,
      status: cvsResult.value.status,
      readyDate: cvsResult.value.readyDate,
    });
  } else {
    results.push({
      platform: "cvs",
      rxNumber,
      status: "error",
      error: cvsResult.reason?.message ?? "Failed to check CVS",
    });
  }

  if (walgResult.status === "fulfilled") {
    results.push({
      platform: "walgreens",
      rxNumber: walgResult.value.rxNumber,
      status: walgResult.value.status,
      readyDate: walgResult.value.readyDate,
      storeName: walgResult.value.storeName,
    });
  } else {
    results.push({
      platform: "walgreens",
      rxNumber,
      status: "error",
      error: walgResult.reason?.message ?? "Failed to check Walgreens",
    });
  }

  return results;
}

/**
 * Compare all retailers to find the best deal for a product.
 */
export async function findBestDeal(
  productName: string,
  zipCode: string
): Promise<{
  bestDeal: PriceComparison | null;
  allResults: PriceComparison[];
  platformCount: number;
}> {
  const allResults = await comparePrice(productName, zipCode);

  const inStockResults = allResults.filter((r) => r.inStock);
  const bestDeal = inStockResults.length > 0 ? inStockResults[0] : allResults[0] ?? null;

  const platforms = new Set(allResults.map((r) => r.platform));

  return {
    bestDeal,
    allResults,
    platformCount: platforms.size,
  };
}

// ── Platform-specific searches (exposed for direct routes) ──

export { searchTarget, searchPublix, searchMacys };

/**
 * Get Target stores near a zip code.
 */
export async function getTargetStores(zipCode: string): Promise<StoreLocation[]> {
  try {
    const stores = await browserAgentSearch<
      Array<{ storeId: string; name: string; address: string; city: string; state: string; zip: string; phone: string; lat: number; lng: number }>
    >("target", "findStores", { zipCode });

    return stores.map((s) => ({
      platform: "target",
      storeId: String(s.storeId),
      name: String(s.name),
      address: String(s.address),
      city: String(s.city),
      state: String(s.state),
      zip: String(s.zip),
      phone: String(s.phone),
      lat: Number(s.lat),
      lng: Number(s.lng),
      hasPharmacy: false,
    }));
  } catch (err) {
    console.error("[retail-service] Target stores error:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get Publix BOGO deals near a zip code.
 */
export async function getPublixBogo(zipCode: string): Promise<PriceComparison[]> {
  try {
    const deals = await browserAgentSearch<
      Array<{ name: string; price: number; url: string; bogoPrice: number }>
    >("publix", "getBogoDeals", { zipCode });

    return deals.map((d) => ({
      platform: "publix",
      productName: d.name,
      price: d.price,
      url: d.url,
      inStock: true,
      savings: +(d.price - d.bogoPrice).toFixed(2),
    }));
  } catch (err) {
    console.error("[retail-service] Publix BOGO error:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get Macy's current sales and promotions.
 */
export async function getMacysSales(): Promise<PriceComparison[]> {
  try {
    const sales = await browserAgentSearch<
      Array<{ name: string; price: number; url: string; originalPrice: number; inStock: boolean }>
    >("macys", "getSales", {});

    return sales.map((s) => ({
      platform: "macys",
      productName: s.name,
      price: s.price,
      url: s.url,
      inStock: s.inStock,
      savings: s.originalPrice > s.price
        ? +(s.originalPrice - s.price).toFixed(2)
        : undefined,
    }));
  } catch (err) {
    console.error("[retail-service] Macys sales error:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get weekly deals aggregated from all platforms near a zip code.
 */
export async function getWeeklyDeals(zipCode: string): Promise<{
  walmart: PriceComparison[];
  cvs: PriceComparison[];
  walgreens: PriceComparison[];
  target: PriceComparison[];
  publix: PriceComparison[];
  macys: PriceComparison[];
}> {
  const [walmartDeals, cvsDeals, walgDeals, targetDeals, publixDeals, macysDeals] =
    await Promise.allSettled([
      walmart.getDeals().then((items) =>
        items.map((p) => ({
          platform: "walmart" as const,
          productName: p.name,
          price: p.salePrice,
          url: p.productUrl,
          inStock: p.inStock,
          savings: p.msrp > p.salePrice ? +(p.msrp - p.salePrice).toFixed(2) : undefined,
        }))
      ),
      browserAgentSearch<Array<{ name: string; price: number; url: string; inStock: boolean }>>(
        "cvs", "getDeals", { zipCode }
      ).then((items) =>
        items.map((p) => ({
          platform: "cvs" as const,
          productName: p.name,
          price: p.price,
          url: p.url,
          inStock: p.inStock,
        }))
      ),
      walgreens.getDealsAndCoupons().then((deals) =>
        deals.map((d) => ({
          platform: "walgreens" as const,
          productName: d.title,
          price: 0,
          url: "",
          inStock: true,
          savings: undefined,
        }))
      ),
      browserAgentSearch<Array<{ name: string; price: number; url: string; inStock: boolean; savings?: number }>>(
        "target", "getDeals", { zipCode }
      ).then((items) =>
        items.map((p) => ({
          platform: "target" as const,
          productName: p.name,
          price: p.price,
          url: p.url,
          inStock: p.inStock,
          savings: p.savings,
        }))
      ),
      getPublixBogo(zipCode),
      getMacysSales(),
    ]);

  return {
    walmart: walmartDeals.status === "fulfilled" ? walmartDeals.value : [],
    cvs: cvsDeals.status === "fulfilled" ? cvsDeals.value : [],
    walgreens: walgDeals.status === "fulfilled" ? walgDeals.value : [],
    target: targetDeals.status === "fulfilled" ? targetDeals.value : [],
    publix: publixDeals.status === "fulfilled" ? publixDeals.value : [],
    macys: macysDeals.status === "fulfilled" ? macysDeals.value : [],
  };
}
