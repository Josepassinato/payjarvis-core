/**
 * Commerce Service: Hotels (SerpAPI primary, Amadeus fallback)
 *
 * Primary: SerpAPI Google Hotels — real prices, booking links, ratings
 * Fallback: Amadeus Hotel List → Hotel Offers → Offer Details
 * Auth: OAuth2 client_credentials with token caching and 401 retry (Amadeus)
 */

import { searchHotelsSerpApi } from "../search/serpapi-travel.service.js";

const BASE = process.env.AMADEUS_ENV === "production"
  ? "https://api.amadeus.com"
  : "https://test.api.amadeus.com";

let token: string | null = null;
let tokenExpiry = 0;

// ─── City Code Map ──────────────────────────────────

const CITY_CODES: Record<string, string> = {
  // US
  'miami': 'MIA', 'new york': 'NYC', 'los angeles': 'LAX',
  'chicago': 'CHI', 'san francisco': 'SFO', 'orlando': 'ORL',
  'las vegas': 'LAS', 'boston': 'BOS', 'washington': 'WAS',
  'houston': 'HOU', 'dallas': 'DFW', 'atlanta': 'ATL',
  'seattle': 'SEA', 'denver': 'DEN', 'philadelphia': 'PHL',
  // Brazil
  'são paulo': 'SAO', 'sao paulo': 'SAO', 'rio de janeiro': 'RIO',
  'brasília': 'BSB', 'brasilia': 'BSB', 'belo horizonte': 'BHZ',
  'salvador': 'SSA', 'recife': 'REC', 'fortaleza': 'FOR',
  'curitiba': 'CWB', 'porto alegre': 'POA', 'manaus': 'MAO',
  // Europe
  'lisboa': 'LIS', 'lisbon': 'LIS', 'porto': 'OPO',
  'paris': 'PAR', 'london': 'LON', 'madrid': 'MAD',
  'barcelona': 'BCN', 'rome': 'ROM', 'roma': 'ROM',
  'berlin': 'BER', 'amsterdam': 'AMS', 'dublin': 'DUB',
  'zürich': 'ZRH', 'zurich': 'ZRH', 'vienna': 'VIE',
  // Other
  'tokyo': 'TYO', 'cancun': 'CUN', 'dubai': 'DXB',
  'bangkok': 'BKK', 'singapore': 'SIN', 'buenos aires': 'BUE',
  'bogota': 'BOG', 'lima': 'LIM', 'santiago': 'SCL',
  'mexico city': 'MEX', 'toronto': 'YTO', 'sydney': 'SYD',
};

/**
 * Resolve city name to IATA code.
 * If input is already 3 uppercase letters, returns as-is.
 * Falls back to Amadeus City Search API.
 */
export async function resolveCityCode(input: string): Promise<string> {
  const trimmed = input.trim();

  // Already an IATA code
  if (/^[A-Z]{3}$/.test(trimmed)) return trimmed;

  // Lookup in map (case-insensitive)
  const lower = trimmed.toLowerCase();
  if (CITY_CODES[lower]) return CITY_CODES[lower];

  // Fallback: Amadeus City Search API
  if (isConfigured()) {
    try {
      const data = await amadeusGet("/v1/reference-data/locations", {
        keyword: trimmed,
        subType: "CITY",
      });
      const city = data.data?.[0];
      if (city?.iataCode) return city.iataCode;
    } catch {
      // Ignore — return uppercase input as last resort
    }
  }

  return trimmed.toUpperCase().substring(0, 3);
}

// ─── Auth ────────────────────────────────────────────

function isConfigured(): boolean {
  return !!(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET
    && process.env.AMADEUS_CLIENT_ID !== "CHANGE_ME");
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && token && Date.now() < tokenExpiry) return token;

  const res = await fetch(`${BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${process.env.AMADEUS_CLIENT_ID}&client_secret=${process.env.AMADEUS_CLIENT_SECRET}`,
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(data.error_description || "Amadeus auth failed");
  token = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return token!;
}

async function amadeusGet(path: string, params: Record<string, string> = {}, retry = true): Promise<any> {
  const t = await getToken();
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? "?" + qs : ""}`;

  console.log(`[AMADEUS] GET ${path} params=${JSON.stringify(params)}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${t}` },
  });

  // 401 → token expired, refresh and retry once
  if (res.status === 401 && retry) {
    console.log("[AMADEUS] 401 — refreshing token and retrying");
    token = null;
    tokenExpiry = 0;
    return amadeusGet(path, params, false);
  }

  const data = await res.json() as any;
  if (!res.ok) {
    const errMsg = data.detail || data.errors?.[0]?.detail || JSON.stringify(data.errors?.[0]) || "Amadeus API error";
    throw new Error(errMsg);
  }
  return data;
}

// ─── Interfaces ──────────────────────────────────────

export interface HotelSearchParams {
  city?: string;      // City name or IATA code
  checkIn: string;    // YYYY-MM-DD
  checkOut: string;   // YYYY-MM-DD
  adults?: number;
  maxPrice?: number;  // Max price per night
  currency?: string;
  ratings?: string[]; // e.g. ["4", "5"]
  radius?: number;    // km from center
  latitude?: number;  // GPS latitude for nearby search
  longitude?: number; // GPS longitude for nearby search
}

export interface HotelResult {
  name: string;
  hotelId: string;
  stars: string;
  price: string;
  pricePerNight: string;
  priceNumeric: number;
  totalPrice: number;
  currency: string;
  rating: string;
  roomType: string;
  cancellation: string;
  offerId: string;
  nights: number;
  bookingLink?: string;
  address?: string;
  reviewCount?: number;
}

// ─── Search ──────────────────────────────────────────

function daysBetween(d1: string, d2: string): number {
  return Math.max(1, Math.ceil((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000));
}

export async function searchHotels(params: HotelSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: HotelResult[];
  error?: string;
}> {
  const location = params.city || "";
  console.log(`[HOTELS] Searching ${location}, ${params.checkIn} to ${params.checkOut}`);

  // ─── Try SerpAPI first (real prices + booking links) ───
  try {
    const serpResult = await searchHotelsSerpApi({
      location,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      guests: params.adults || 1,
      maxResults: 5,
    });

    if (serpResult.hotels.length > 0) {
      const nights = daysBetween(params.checkIn, params.checkOut);
      const results: HotelResult[] = serpResult.hotels.map((h) => ({
        name: h.name,
        hotelId: "",
        stars: h.rating ? String(Math.round(h.rating / 2)) : "N/A",
        price: h.price ? `${h.currency} ${(h.price * nights).toFixed(2)}` : "N/A",
        pricePerNight: h.price ? `${h.currency} ${h.price.toFixed(2)}` : "N/A",
        priceNumeric: h.price || 0,
        totalPrice: h.price ? h.price * nights : 0,
        currency: h.currency,
        rating: h.rating ? String(h.rating) : "N/A",
        roomType: h.amenities.slice(0, 3).join(", ") || "Standard",
        cancellation: "",
        offerId: "",
        nights,
        bookingLink: h.link || "",
        address: h.address || "",
        reviewCount: h.reviews || 0,
      }));

      // Filter by maxPrice per night if specified
      const filtered = params.maxPrice
        ? results.filter((r) => r.priceNumeric > 0 && r.priceNumeric <= params.maxPrice!)
        : results.filter((r) => r.priceNumeric > 0);

      filtered.sort((a, b) => a.priceNumeric - b.priceNumeric);
      console.log(`[HOTELS] SerpAPI returned ${filtered.length} results for ${location}`);
      return { source: "serpapi", mock: false, results: filtered.slice(0, 5) };
    }
  } catch (err) {
    console.warn("[HOTELS] SerpAPI failed, trying Amadeus:", err instanceof Error ? err.message : err);
  }

  // ─── Fallback: Amadeus API ───
  const useGeocode = params.latitude && params.longitude && !params.city;
  const cityCode = useGeocode ? "" : await resolveCityCode(params.city || "");

  if (!isConfigured()) {
    return { source: "amadeus", mock: true, results: mockHotels(params) };
  }

  try {
    let listData: any;
    if (useGeocode) {
      const listParams: Record<string, string> = {
        latitude: String(params.latitude),
        longitude: String(params.longitude),
        radius: String(params.radius ?? 20),
        radiusUnit: "KM",
        hotelSource: "ALL",
      };
      if (params.ratings?.length) listParams.ratings = params.ratings.join(",");
      listData = await amadeusGet("/v1/reference-data/locations/hotels/by-geocode", listParams);
    } else {
      const listParams: Record<string, string> = {
        cityCode,
        radius: String(params.radius ?? 20),
        radiusUnit: "KM",
        hotelSource: "ALL",
      };
      if (params.ratings?.length) listParams.ratings = params.ratings.join(",");
      listData = await amadeusGet("/v1/reference-data/locations/hotels/by-city", listParams);
    }
    const hotelIds = (listData.data || []).slice(0, 30).map((h: any) => h.hotelId);
    if (hotelIds.length === 0) return { source: "amadeus", mock: false, results: [] };

    const currency = params.currency || "USD";
    const offersData = await amadeusGet("/v3/shopping/hotel-offers", {
      hotelIds: hotelIds.join(","),
      checkInDate: params.checkIn,
      checkOutDate: params.checkOut,
      adults: String(params.adults ?? 1),
      currency,
    });

    const nights = daysBetween(params.checkIn, params.checkOut);

    const results: HotelResult[] = (offersData.data || []).slice(0, 10).map((hotel: any) => {
      const offer = hotel.offers?.[0];
      const total = offer ? parseFloat(offer.price.total) : 0;
      const perNight = total / nights;
      const cur = offer?.price?.currency || currency;
      const cancelPolicy = offer?.policies?.cancellations?.[0];
      const cancelText = cancelPolicy?.type === "FULL_REFUNDABLE"
        ? `Cancelamento gratuito até ${cancelPolicy.deadline?.substring(0, 10) || "check policy"}`
        : cancelPolicy?.description?.text || "Consulte política";

      return {
        name: hotel.hotel?.name || "Unknown",
        hotelId: hotel.hotel?.hotelId || "",
        stars: hotel.hotel?.rating || "N/A",
        price: `${cur} ${total.toFixed(2)}`,
        pricePerNight: `${cur} ${perNight.toFixed(2)}`,
        priceNumeric: perNight,
        totalPrice: total,
        currency: cur,
        rating: hotel.hotel?.rating || "N/A",
        roomType: offer?.room?.typeEstimated?.category || offer?.room?.description?.text || "Standard",
        cancellation: cancelText,
        offerId: offer?.id || "",
        nights,
      };
    });

    const filtered = params.maxPrice
      ? results.filter((r) => r.priceNumeric <= params.maxPrice!)
      : results;

    filtered.sort((a, b) => a.priceNumeric - b.priceNumeric);

    return { source: "amadeus", mock: false, results: filtered.slice(0, 5) };
  } catch (err) {
    console.error("[HOTELS] Amadeus search error:", err instanceof Error ? err.message : err);
    return {
      source: "amadeus",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "Hotel search failed",
    };
  }
}

// ─── Offer Details (Step 3) ──────────────────────────

export async function getHotelOffer(offerId: string): Promise<{
  source: string;
  offer: any | null;
  error?: string;
}> {
  if (!isConfigured()) {
    return { source: "amadeus", offer: null, error: "Amadeus API not configured — fill AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET" };
  }

  try {
    const data = await amadeusGet(`/v3/shopping/hotel-offers/${offerId}`);
    return { source: "amadeus", offer: data.data || null };
  } catch (err) {
    return {
      source: "amadeus",
      offer: null,
      error: err instanceof Error ? err.message : "Failed to get offer details",
    };
  }
}

// ─── Format for Telegram ─────────────────────────────

export function formatHotelResults(results: HotelResult[], city: string): string {
  if (results.length === 0) {
    return `Não encontrei hotéis disponíveis em ${city} para essas datas. Tente outras datas ou uma cidade próxima.`;
  }

  const nights = results[0]?.nights || 1;
  const header = `🏨 Hotéis em ${city} (${nights} noite${nights > 1 ? "s" : ""})\n`;

  const items = results.map((h, i) => {
    const lines = [`${i + 1}. ${h.name} ⭐ ${h.rating}`];
    if (h.priceNumeric > 0) {
      lines.push(`   💰 ${h.currency} ${h.priceNumeric.toFixed(0)}/noite (total: ${h.currency} ${h.totalPrice.toFixed(0)})`);
    }
    if (h.address) lines.push(`   📍 ${h.address}`);
    if (h.roomType && h.roomType !== "Standard") lines.push(`   📋 ${h.roomType}`);
    if (h.cancellation) lines.push(`   🔄 ${h.cancellation}`);
    if (h.bookingLink) lines.push(`   🔗 ${h.bookingLink}`);
    return lines.join("\n");
  });

  return header + "\n" + items.join("\n\n") + "\n\nQual quer reservar? 🐕";
}

// ─── Mock Data ───────────────────────────────────────

function mockHotels(p: HotelSearchParams): HotelResult[] {
  const nights = daysBetween(p.checkIn, p.checkOut);
  return [
    {
      name: "Downtown Comfort Inn", hotelId: "MOCK001", stars: "4",
      price: `USD ${(160 * nights).toFixed(2)}`, pricePerNight: "USD 160.00",
      priceNumeric: 160, totalPrice: 160 * nights, currency: "USD",
      rating: "4.2", roomType: "Standard King",
      cancellation: "Cancelamento gratuito até 3 dias antes",
      offerId: "mock-offer-001", nights,
    },
    {
      name: "City Center Hilton", hotelId: "MOCK002", stars: "5",
      price: `USD ${(250 * nights).toFixed(2)}`, pricePerNight: "USD 250.00",
      priceNumeric: 250, totalPrice: 250 * nights, currency: "USD",
      rating: "4.7", roomType: "Deluxe Double",
      cancellation: "Cancelamento gratuito até 7 dias antes",
      offerId: "mock-offer-002", nights,
    },
    {
      name: "Budget Express Hotel", hotelId: "MOCK003", stars: "3",
      price: `USD ${(90 * nights).toFixed(2)}`, pricePerNight: "USD 90.00",
      priceNumeric: 90, totalPrice: 90 * nights, currency: "USD",
      rating: "3.8", roomType: "Standard Double",
      cancellation: "Não reembolsável",
      offerId: "mock-offer-003", nights,
    },
  ];
}
