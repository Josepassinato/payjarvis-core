/**
 * FlixBus API Client
 *
 * Provides bus trip search, city lookup, and trip details via the
 * FlixBus community transport.rest API (free, no key required).
 * Also powers Greyhound searches (acquired 2021).
 *
 * Optional env vars:
 *  - FLIXBUS_API_KEY (for official API — not required for free endpoints)
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface BusTrip {
  tripId: string;
  carrier: "flixbus" | "greyhound";
  origin: string;
  destination: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  price: number;
  currency: string;
  seatsAvailable: number;
  amenities: string[];
  isDirectRoute: boolean;
  transfers: number;
}

export interface BusStation {
  id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  lat: number;
  lng: number;
}

export interface BusTripDetail {
  tripId: string;
  carrier: "flixbus" | "greyhound";
  origin: BusStation;
  destination: BusStation;
  departTime: string;
  arriveTime: string;
  duration: string;
  price: number;
  currency: string;
  seatsAvailable: number;
  amenities: string[];
  isDirectRoute: boolean;
  transfers: number;
  stops: BusStation[];
  operator: string;
  busType: string;
}

export interface BookingConfirmation {
  bookingId: string;
  tripId: string;
  status: string;
  passengerName: string;
  totalPrice: number;
  currency: string;
  qrCodeUrl: string;
  departTime: string;
  origin: string;
  destination: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLIXBUS_FREE_BASE = "https://1.flixbus.transport.rest";
const FLIXBUS_OFFICIAL_BASE = "https://global.api.flixbus.com/search/service/v4";
const REQUEST_TIMEOUT = 15_000;

/**
 * Map of common US city names / aliases to FlixBus city IDs.
 * These are resolved during search to simplify user queries.
 */
const CITY_ALIASES: Record<string, string> = {
  miami: "miami",
  "new york": "new-york",
  nyc: "new-york",
  washington: "washington",
  dc: "washington",
  chicago: "chicago",
  "los angeles": "los-angeles",
  la: "los-angeles",
  orlando: "orlando",
  philadelphia: "philadelphia",
  boston: "boston",
  "san francisco": "san-francisco",
  seattle: "seattle",
  denver: "denver",
  atlanta: "atlanta",
  houston: "houston",
  dallas: "dallas",
  phoenix: "phoenix",
  "las vegas": "las-vegas",
  vegas: "las-vegas",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string | null {
  return process.env.FLIXBUS_API_KEY ?? null;
}

/**
 * Check if FlixBus client is ready. Always true — free endpoints need no key.
 */
export function isConfigured(): boolean {
  return true;
}

/** Whether the official API key is available. */
function hasOfficialApi(): boolean {
  return !!process.env.FLIXBUS_API_KEY;
}

/**
 * Resolve a city name or alias to a normalized city slug.
 */
export function resolveCity(query: string): string {
  const normalized = query.trim().toLowerCase();
  if (CITY_ALIASES[normalized]) {
    return CITY_ALIASES[normalized];
  }
  // Partial match
  for (const [alias, slug] of Object.entries(CITY_ALIASES)) {
    if (alias.includes(normalized) || normalized.includes(alias)) {
      return slug;
    }
  }
  // Return slugified input as fallback
  return normalized.replace(/\s+/g, "-");
}

/** Fetch from the free community API (no key needed). */
async function flixbusFreeFetch(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const url = new URL(path, FLIXBUS_FREE_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "PayJarvis/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`FlixBus free API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

/** Fetch from the official FlixBus API (requires key). */
async function flixbusOfficialFetch(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const url = new URL(path, FLIXBUS_OFFICIAL_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Token ${getApiKey()}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`FlixBus API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

function detectCarrier(raw: Record<string, unknown>): "flixbus" | "greyhound" {
  const operator = String(raw.operator ?? raw.brand ?? raw.carrier ?? "").toLowerCase();
  if (operator.includes("greyhound")) return "greyhound";
  return "flixbus";
}

function mapTrip(raw: Record<string, unknown>): BusTrip {
  const transfers = Number(raw.transfers ?? raw.transfer_count ?? 0);
  return {
    tripId: String(raw.tripId ?? raw.uid ?? raw.id ?? ""),
    carrier: detectCarrier(raw),
    origin: String(raw.origin ?? raw.from ?? ""),
    destination: String(raw.destination ?? raw.to ?? ""),
    departTime: String(raw.departTime ?? raw.departure ?? raw.depart_time ?? ""),
    arriveTime: String(raw.arriveTime ?? raw.arrival ?? raw.arrive_time ?? ""),
    duration: String(raw.duration ?? ""),
    price: Number(raw.price ?? (raw as any)?.price_total?.amount ?? 0),
    currency: String(raw.currency ?? (raw as any)?.price_total?.currency ?? "USD"),
    seatsAvailable: Number(raw.seatsAvailable ?? raw.available_seats ?? 0),
    amenities: Array.isArray(raw.amenities) ? raw.amenities.map(String) : [],
    isDirectRoute: transfers === 0,
    transfers,
  };
}

function mapStation(raw: Record<string, unknown>): BusStation {
  return {
    id: String(raw.id ?? raw.uuid ?? ""),
    name: String(raw.name ?? ""),
    city: String(raw.city ?? raw.city_name ?? ""),
    state: String(raw.state ?? raw.region ?? ""),
    address: String(raw.address ?? ""),
    lat: Number(raw.lat ?? raw.latitude ?? (raw as any)?.location?.lat ?? 0),
    lng: Number(raw.lng ?? raw.longitude ?? (raw as any)?.location?.lng ?? 0),
  };
}

function mapTripDetail(raw: Record<string, unknown>): BusTripDetail {
  const transfers = Number(raw.transfers ?? raw.transfer_count ?? 0);
  const rawStops: unknown[] = (raw as any)?.stops ?? (raw as any)?.intermediate_stops ?? [];
  const originRaw = (raw as any)?.origin_station ?? (raw as any)?.from_station ?? {};
  const destRaw = (raw as any)?.destination_station ?? (raw as any)?.to_station ?? {};

  return {
    tripId: String(raw.tripId ?? raw.uid ?? raw.id ?? ""),
    carrier: detectCarrier(raw),
    origin: mapStation(originRaw as Record<string, unknown>),
    destination: mapStation(destRaw as Record<string, unknown>),
    departTime: String(raw.departTime ?? raw.departure ?? ""),
    arriveTime: String(raw.arriveTime ?? raw.arrival ?? ""),
    duration: String(raw.duration ?? ""),
    price: Number(raw.price ?? (raw as any)?.price_total?.amount ?? 0),
    currency: String(raw.currency ?? (raw as any)?.price_total?.currency ?? "USD"),
    seatsAvailable: Number(raw.seatsAvailable ?? raw.available_seats ?? 0),
    amenities: Array.isArray(raw.amenities) ? raw.amenities.map(String) : [],
    isDirectRoute: transfers === 0,
    transfers,
    stops: rawStops.map((s) => mapStation(s as Record<string, unknown>)),
    operator: String(raw.operator ?? raw.brand ?? "FlixBus"),
    busType: String(raw.busType ?? raw.bus_type ?? "Standard"),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search for cities/locations matching a query string.
 * Uses free transport.rest endpoint; falls back to official API if available.
 */
export async function searchCities(
  query: string
): Promise<{ id: string; name: string; country: string }[]> {
  try {
    // Free endpoint: /locations?query=...
    const data = (await flixbusFreeFetch("/locations", {
      query: query.trim(),
    })) as any;

    const locations: unknown[] = Array.isArray(data) ? data : data?.locations ?? data?.data ?? [];
    return locations.map((c: any) => ({
      id: String(c.id ?? c.uuid ?? ""),
      name: String(c.name ?? ""),
      country: String(c.country ?? c.country_code ?? "US"),
    }));
  } catch (err) {
    console.error(
      "[flixbus] searchCities free API error:",
      err instanceof Error ? err.message : err
    );

    // Fall back to official API if key is available
    if (hasOfficialApi()) {
      try {
        const data = (await flixbusOfficialFetch("/cities/autocomplete", {
          q: query.trim(),
          locale: "en",
          country: "US",
        })) as any;

        const cities: unknown[] = data?.cities ?? data?.data ?? data ?? [];
        return (Array.isArray(cities) ? cities : []).map((c: any) => ({
          id: String(c.id ?? c.uuid ?? ""),
          name: String(c.name ?? ""),
          country: String(c.country ?? c.country_code ?? "US"),
        }));
      } catch (err2) {
        console.error(
          "[flixbus] searchCities official API error:",
          err2 instanceof Error ? err2.message : err2
        );
      }
    }

    return [];
  }
}

/**
 * Search for bus trips between two city IDs.
 * Uses free transport.rest endpoint; falls back to official API if available.
 */
export async function searchTrips(
  originId: string,
  destinationId: string,
  date: string,
  adults: number = 1,
  children: number = 0
): Promise<BusTrip[]> {
  try {
    // Free endpoint: /journeys?from=...&to=...&date=...&adult=...
    const params: Record<string, string> = {
      from: originId,
      to: destinationId,
      date,
      adult: String(adults),
    };
    if (children > 0) params.children = String(children);

    const data = (await flixbusFreeFetch("/journeys", params)) as any;
    const trips: unknown[] = Array.isArray(data)
      ? data
      : data?.journeys ?? data?.trips ?? data?.data ?? [];
    return (Array.isArray(trips) ? trips : []).map((t) =>
      mapTrip(t as Record<string, unknown>)
    );
  } catch (err) {
    console.error(
      "[flixbus] searchTrips free API error:",
      err instanceof Error ? err.message : err
    );

    // Fall back to official API if key is available
    if (hasOfficialApi()) {
      try {
        const params: Record<string, string> = {
          from_city_id: originId,
          to_city_id: destinationId,
          departure_date: date,
          products: JSON.stringify({
            adult: adults,
            ...(children > 0 ? { child: children } : {}),
          }),
          currency: "USD",
          locale: "en",
        };

        const data = (await flixbusOfficialFetch("/search", params)) as any;
        const trips: unknown[] =
          data?.trips ?? data?.available_trips ?? data?.data ?? [];
        return (Array.isArray(trips) ? trips : []).map((t) =>
          mapTrip(t as Record<string, unknown>)
        );
      } catch (err2) {
        console.error(
          "[flixbus] searchTrips official API error:",
          err2 instanceof Error ? err2.message : err2
        );
      }
    }

    return [];
  }
}

/**
 * Get detailed information about a specific trip.
 * Falls back to official API if the free endpoint does not support this.
 */
export async function getTripDetails(
  tripId: string
): Promise<BusTripDetail | null> {
  // The free API does not have a trip details endpoint, so try official first
  if (hasOfficialApi()) {
    try {
      const data = (await flixbusOfficialFetch(`/trip/${tripId}`, {
        locale: "en",
      })) as any;

      if (!data || (!data.tripId && !data.uid && !data.id)) {
        return null;
      }

      return mapTripDetail(data as Record<string, unknown>);
    } catch (err) {
      console.error(
        "[flixbus] getTripDetails error:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return null;
}
