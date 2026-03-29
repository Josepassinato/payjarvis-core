/**
 * Google Maps Services — Directions, Geocoding, Distance Matrix
 *
 * Uses standard Maps APIs (maps.googleapis.com).
 * Falls back to GEMINI_API_KEY if GOOGLE_PLACES_API_KEY is not set.
 */

const MAPS_BASE = "https://maps.googleapis.com/maps/api";

function getApiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GEMINI_API_KEY || null;
}

// ─── Directions ─────────────────────────────────────

export interface DirectionsParams {
  origin: string;
  destination: string;
  mode?: "driving" | "walking" | "bicycling" | "transit";
  departure_time?: string; // "now" or Unix timestamp
  language?: string;
}

export interface DirectionsResult {
  origin: string;
  destination: string;
  distance: string;
  duration: string;
  durationInTraffic?: string;
  steps: string[];
  polyline?: string;
  error?: string;
}

export async function getDirections(params: DirectionsParams): Promise<DirectionsResult> {
  const key = getApiKey();
  if (!key) {
    return { origin: params.origin, destination: params.destination, distance: "", duration: "", steps: [], error: "Google Maps API key not configured" };
  }

  try {
    const qs = new URLSearchParams({
      origin: params.origin,
      destination: params.destination,
      mode: params.mode || "driving",
      language: params.language || "en",
      key,
    });
    if (params.departure_time) qs.set("departure_time", params.departure_time);

    console.log(`[GOOGLE_MAPS] Directions: ${params.origin} → ${params.destination} (${params.mode || "driving"})`);

    const res = await fetch(`${MAPS_BASE}/directions/json?${qs}`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json() as any;

    if (data.status !== "OK") {
      return { origin: params.origin, destination: params.destination, distance: "", duration: "", steps: [], error: data.error_message || data.status };
    }

    const leg = data.routes[0].legs[0];
    return {
      origin: leg.start_address,
      destination: leg.end_address,
      distance: leg.distance.text,
      duration: leg.duration.text,
      durationInTraffic: leg.duration_in_traffic?.text,
      steps: leg.steps.slice(0, 8).map((s: any) =>
        s.html_instructions.replace(/<[^>]*>/g, "") + ` (${s.distance.text})`
      ),
    };
  } catch (err) {
    console.error("[GOOGLE_MAPS] Directions error:", err instanceof Error ? err.message : err);
    return { origin: params.origin, destination: params.destination, distance: "", duration: "", steps: [], error: err instanceof Error ? err.message : "Directions failed" };
  }
}

// ─── Geocoding ──────────────────────────────────────

export interface GeocodeResult {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId: string;
  components: Record<string, string>;
  error?: string;
}

export async function geocode(address: string): Promise<GeocodeResult> {
  const key = getApiKey();
  if (!key) {
    return { formattedAddress: "", latitude: 0, longitude: 0, placeId: "", components: {}, error: "API key not configured" };
  }

  try {
    const res = await fetch(`${MAPS_BASE}/geocode/json?address=${encodeURIComponent(address)}&key=${key}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json() as any;

    if (data.status !== "OK" || !data.results?.[0]) {
      return { formattedAddress: "", latitude: 0, longitude: 0, placeId: "", components: {}, error: data.error_message || data.status };
    }

    const r = data.results[0];
    const components: Record<string, string> = {};
    for (const c of r.address_components || []) {
      for (const type of c.types) {
        components[type] = c.long_name;
      }
    }

    return {
      formattedAddress: r.formatted_address,
      latitude: r.geometry.location.lat,
      longitude: r.geometry.location.lng,
      placeId: r.place_id,
      components,
    };
  } catch (err) {
    return { formattedAddress: "", latitude: 0, longitude: 0, placeId: "", components: {}, error: err instanceof Error ? err.message : "Geocoding failed" };
  }
}

// ─── Reverse Geocoding ──────────────────────────────

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  const key = getApiKey();
  if (!key) {
    return { formattedAddress: "", latitude: lat, longitude: lng, placeId: "", components: {}, error: "API key not configured" };
  }

  try {
    const res = await fetch(`${MAPS_BASE}/geocode/json?latlng=${lat},${lng}&key=${key}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json() as any;

    if (data.status !== "OK" || !data.results?.[0]) {
      return { formattedAddress: "", latitude: lat, longitude: lng, placeId: "", components: {}, error: data.status };
    }

    const r = data.results[0];
    const components: Record<string, string> = {};
    for (const c of r.address_components || []) {
      for (const type of c.types) {
        components[type] = c.long_name;
      }
    }

    return { formattedAddress: r.formatted_address, latitude: lat, longitude: lng, placeId: r.place_id, components };
  } catch (err) {
    return { formattedAddress: "", latitude: lat, longitude: lng, placeId: "", components: {}, error: err instanceof Error ? err.message : "Reverse geocoding failed" };
  }
}
