/**
 * Commerce Service: Google Places (New API)
 *
 * Uses Places API (New) — same Google Cloud project as Gemini, uses GEMINI_API_KEY.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/op-overview
 *
 * Endpoints used:
 * - POST /v1/places:searchText    — text search (e.g. "italian restaurant miami")
 * - POST /v1/places:searchNearby  — nearby search by lat/lng + radius
 * - GET  /v1/places/{placeId}     — place details
 *
 * Replaces legacy Places API (maps.googleapis.com/maps/api/place).
 */

const PLACES_NEW_BASE = "https://places.googleapis.com/v1";

function getApiKey(): string | null {
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (placesKey && placesKey !== "CHANGE_ME") return placesKey;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && geminiKey !== "CHANGE_ME") return geminiKey;

  return null;
}

function isConfigured(): boolean {
  return !!getApiKey();
}

// Track if API is actually enabled (avoids repeated failed calls)
let _apiDisabled = false;
let _apiDisabledAt = 0;
const DISABLED_RETRY_MS = 300_000; // retry after 5 min

function isApiDisabled(): boolean {
  if (!_apiDisabled) return false;
  if (Date.now() - _apiDisabledAt > DISABLED_RETRY_MS) {
    _apiDisabled = false;
    return false;
  }
  return true;
}

function markApiDisabled() {
  _apiDisabled = true;
  _apiDisabledAt = Date.now();
}

// ─── Interfaces ──────────────────────────────────────

export interface PlacesSearchParams {
  query?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;         // meters (default 5000 for nearby)
  type?: string;           // "restaurant", "bar", "cafe", "lodging", "hotel"
  language?: string;       // "pt-BR", "en", "es"
  maxResults?: number;
  openNow?: boolean;
}

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  rating: number;
  totalRatings: number;
  priceLevel: string;
  isOpen: boolean | null;
  types: string[];
  latitude: number;
  longitude: number;
  googleMapsUrl: string;
  distance?: string;
  photos: string[];
}

export interface PlaceDetail {
  placeId: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  rating: number;
  totalRatings: number;
  priceLevel: string;
  isOpen: boolean | null;
  reviews: PlaceReview[];
  hours: string[];
  googleMapsUrl: string;
  photos: string[];
}

export interface PlaceReview {
  authorName: string;
  rating: number;
  text: string;
  relativeTime: string;
}

// ─── Price Level Mapping ─────────────────────────────

function mapPriceLevel(level?: string): string {
  const map: Record<string, string> = {
    PRICE_LEVEL_FREE: "Free",
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return map[level || ""] || "N/A";
}

// ─── Type Mapping ────────────────────────────────────

function mapTypeToIncludedTypes(type?: string): string[] {
  const map: Record<string, string[]> = {
    restaurant: ["restaurant"],
    bar: ["bar"],
    cafe: ["cafe"],
    lodging: ["lodging"],
    hotel: ["lodging"],
    pharmacy: ["pharmacy"],
    supermarket: ["supermarket", "grocery_store"],
    gas_station: ["gas_station"],
    hospital: ["hospital"],
    gym: ["gym"],
  };
  return map[type || "restaurant"] || ["restaurant"];
}

// ─── Common headers ─────────────────────────────────

function apiHeaders(fieldMask: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": getApiKey()!,
    "X-Goog-FieldMask": fieldMask,
  };
}

const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.currentOpeningHours",
  "places.types",
  "places.location",
  "places.googleMapsUri",
  "places.photos",
].join(",");

// ─── Text Search ─────────────────────────────────────

export async function searchPlaces(params: PlacesSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: PlaceResult[];
  error?: string;
}> {
  if (!isConfigured() || isApiDisabled()) {
    return { source: "google_places", mock: true, results: mockPlaces(params) };
  }

  try {
    // Nearby search when coords but no query
    if (params.latitude && params.longitude && !params.query) {
      return await searchNearby(params);
    }

    const body: Record<string, unknown> = {
      textQuery: params.query || "restaurant",
      maxResultCount: Math.min(params.maxResults || 10, 20),
    };

    if (params.language) body.languageCode = params.language;
    if (params.openNow) body.openNow = true;

    // Use coordinates as location bias
    if (params.latitude && params.longitude) {
      body.locationBias = {
        circle: {
          center: { latitude: params.latitude, longitude: params.longitude },
          radius: params.radius || 10000,
        },
      };
    }

    if (params.type) body.includedType = params.type;

    console.log(`[GOOGLE_PLACES] Text search: "${params.query}" lat=${params.latitude || ''} lng=${params.longitude || ''}`);

    const res = await fetch(`${PLACES_NEW_BASE}/places:searchText`, {
      method: "POST",
      headers: apiHeaders(SEARCH_FIELDS),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      const errMsg = data.error?.message || `HTTP ${res.status}`;
      if (data.error?.status === "PERMISSION_DENIED") markApiDisabled();
      throw new Error(errMsg);
    }

    const results = mapPlacesResults(data.places || [], params.latitude, params.longitude);
    console.log(`[GOOGLE_PLACES] Found ${results.length} results`);

    return { source: "google_places", mock: false, results };
  } catch (err) {
    console.error("[GOOGLE_PLACES] Search error:", err instanceof Error ? err.message : err);
    return {
      source: "google_places",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "Google Places search failed",
    };
  }
}

// ─── Nearby Search ──────────────────────────────────

async function searchNearby(params: PlacesSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: PlaceResult[];
  error?: string;
}> {
  try {
    const body: Record<string, unknown> = {
      includedTypes: mapTypeToIncludedTypes(params.type),
      maxResultCount: Math.min(params.maxResults || 10, 20),
      locationRestriction: {
        circle: {
          center: { latitude: params.latitude, longitude: params.longitude },
          radius: params.radius || 5000,
        },
      },
    };

    if (params.language) body.languageCode = params.language;

    console.log(`[GOOGLE_PLACES] Nearby: lat=${params.latitude} lng=${params.longitude} type=${params.type || 'restaurant'}`);

    const res = await fetch(`${PLACES_NEW_BASE}/places:searchNearby`, {
      method: "POST",
      headers: apiHeaders(SEARCH_FIELDS),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      const errMsg = data.error?.message || `HTTP ${res.status}`;
      if (data.error?.status === "PERMISSION_DENIED") markApiDisabled();
      throw new Error(errMsg);
    }

    const results = mapPlacesResults(data.places || [], params.latitude, params.longitude);
    console.log(`[GOOGLE_PLACES] Nearby found ${results.length} results`);

    return { source: "google_places", mock: false, results };
  } catch (err) {
    console.error("[GOOGLE_PLACES] Nearby error:", err instanceof Error ? err.message : err);
    return {
      source: "google_places",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "Nearby search failed",
    };
  }
}

// ─── Map API response to PlaceResult ─────────────────

function mapPlacesResults(places: any[], userLat?: number, userLng?: number): PlaceResult[] {
  return places.map((p: any) => {
    const lat = p.location?.latitude || 0;
    const lng = p.location?.longitude || 0;

    let distance: string | undefined;
    if (userLat && userLng && lat && lng) {
      const d = haversineKm(userLat, userLng, lat, lng);
      distance = d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;
    }

    const apiKey = getApiKey();
    const photos = (p.photos || []).slice(0, 3).map((photo: any) => {
      const name = photo.name || "";
      return name ? `${PLACES_NEW_BASE}/${name}/media?maxWidthPx=400&key=${apiKey}` : "";
    }).filter(Boolean);

    return {
      placeId: p.id || "",
      name: p.displayName?.text || "",
      address: p.formattedAddress || "",
      rating: p.rating || 0,
      totalRatings: p.userRatingCount || 0,
      priceLevel: mapPriceLevel(p.priceLevel),
      isOpen: p.currentOpeningHours?.openNow ?? null,
      types: p.types || [],
      latitude: lat,
      longitude: lng,
      googleMapsUrl: p.googleMapsUri || "",
      distance,
      photos,
    };
  });
}

// ─── Place Details ───────────────────────────────────

const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "priceLevel",
  "currentOpeningHours",
  "reviews",
  "googleMapsUri",
  "photos",
].join(",");

export async function getPlaceDetails(placeId: string): Promise<{
  source: string;
  detail: PlaceDetail | null;
  error?: string;
}> {
  if (!isConfigured() || isApiDisabled()) {
    return { source: "google_places", detail: null, error: "Google Places API not configured" };
  }

  try {
    console.log(`[GOOGLE_PLACES] Details: ${placeId}`);

    const res = await fetch(`${PLACES_NEW_BASE}/places/${placeId}`, {
      headers: apiHeaders(DETAIL_FIELDS),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }

    const apiKey = getApiKey();
    const photos = (data.photos || []).slice(0, 5).map((photo: any) => {
      const name = photo.name || "";
      return name ? `${PLACES_NEW_BASE}/${name}/media?maxWidthPx=800&key=${apiKey}` : "";
    }).filter(Boolean);

    const detail: PlaceDetail = {
      placeId: data.id || placeId,
      name: data.displayName?.text || "",
      address: data.formattedAddress || "",
      phone: data.internationalPhoneNumber || "",
      website: data.websiteUri || "",
      rating: data.rating || 0,
      totalRatings: data.userRatingCount || 0,
      priceLevel: mapPriceLevel(data.priceLevel),
      isOpen: data.currentOpeningHours?.openNow ?? null,
      reviews: (data.reviews || []).slice(0, 3).map((r: any) => ({
        authorName: r.authorAttribution?.displayName || "Anonymous",
        rating: r.rating || 0,
        text: r.text?.text || "",
        relativeTime: r.relativePublishTimeDescription || "",
      })),
      hours: data.currentOpeningHours?.weekdayDescriptions || [],
      googleMapsUrl: data.googleMapsUri || "",
      photos,
    };

    return { source: "google_places", detail };
  } catch (err) {
    return {
      source: "google_places",
      detail: null,
      error: err instanceof Error ? err.message : "Failed to get place details",
    };
  }
}

// ─── Format for Telegram/WhatsApp ────────────────────

export function formatPlacesResults(results: PlaceResult[]): string {
  if (results.length === 0) return "Não encontrei lugares com esses critérios.";

  const items = results.slice(0, 5).map((p, i) => {
    const parts = [
      `${i + 1}. 📍 ${p.name} (⭐ ${p.rating.toFixed(1)} — ${p.totalRatings} reviews)`,
      `   ${p.address}`,
    ];
    if (p.priceLevel && p.priceLevel !== "N/A") parts.push(`   💰 ${p.priceLevel}`);
    if (p.distance) parts.push(`   📏 ${p.distance}`);
    if (p.isOpen !== null) parts.push(`   ${p.isOpen ? "✅ Aberto" : "❌ Fechado"}`);
    if (p.googleMapsUrl) parts.push(`   🗺️ ${p.googleMapsUrl}`);
    return parts.join("\n");
  });

  return items.join("\n\n");
}

// ─── Haversine distance ──────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Mock Data ───────────────────────────────────────

function mockPlaces(params: PlacesSearchParams): PlaceResult[] {
  const query = params.query || params.type || "restaurant";
  return [
    { placeId: "mock-gp-001", name: `Best ${query} Place`, address: "123 Main St", rating: 4.6, totalRatings: 523, priceLevel: "$$", isOpen: true, types: ["restaurant"], latitude: 0, longitude: 0, googleMapsUrl: "", distance: undefined, photos: [] },
    { placeId: "mock-gp-002", name: `${query} Gourmet`, address: "456 Oak Ave", rating: 4.3, totalRatings: 218, priceLevel: "$$$", isOpen: true, types: ["restaurant"], latitude: 0, longitude: 0, googleMapsUrl: "", distance: undefined, photos: [] },
    { placeId: "mock-gp-003", name: `Casa ${query}`, address: "789 Elm Blvd", rating: 4.8, totalRatings: 891, priceLevel: "$", isOpen: false, types: ["restaurant"], latitude: 0, longitude: 0, googleMapsUrl: "", distance: undefined, photos: [] },
  ];
}
