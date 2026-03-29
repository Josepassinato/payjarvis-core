/**
 * SerpAPI Travel Service — Flights, Hotels, Events via Google APIs
 * Replaces Amadeus/Ticketmaster with unified SerpAPI.
 * Redis cached (1h for hotels, 30min for flights).
 */

import { redisGet, redisSet } from "../redis.js";

const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const TIMEOUT = 8000;

// ─── Flights ─────────────────────────────────────────

export interface FlightResult {
  airline: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  price: number | null;
  currency: string;
  departureAirport: string;
  arrivalAirport: string;
  flightNumber: string;
}

export async function searchFlightsSerpApi(opts: {
  from: string;       // Airport code (MIA, JFK) or city name
  to: string;
  date: string;       // YYYY-MM-DD
  returnDate?: string;
  passengers?: number;
  maxResults?: number;
}): Promise<{ flights: FlightResult[]; method: string; fromCache?: boolean }> {
  if (!SERPAPI_KEY) return { flights: [], method: "no_key" };

  const cacheKey = `search:flights:${opts.from}:${opts.to}:${opts.date}:${opts.returnDate || "oneway"}`;
  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      console.log(`[SERPAPI-FLIGHTS] CACHE HIT ${opts.from}→${opts.to}`);
      return { ...parsed, fromCache: true };
    }
  } catch {}

  const params = new URLSearchParams({
    engine: "google_flights",
    api_key: SERPAPI_KEY,
    departure_id: opts.from.toUpperCase(),
    arrival_id: opts.to.toUpperCase(),
    outbound_date: opts.date,
    type: opts.returnDate ? "1" : "2", // 1=roundtrip, 2=one-way
    adults: String(opts.passengers || 1),
    currency: "USD",
    hl: "en",
  });
  if (opts.returnDate) params.set("return_date", opts.returnDate);

  console.log(`[SERPAPI-FLIGHTS] ${opts.from}→${opts.to} on ${opts.date}`);

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (!res.ok) throw new Error(`SerpAPI Flights ${res.status}`);
  const data = await res.json() as any;

  const allFlights = [...(data.best_flights || []), ...(data.other_flights || [])];
  const maxResults = opts.maxResults || 5;

  const flights: FlightResult[] = allFlights.slice(0, maxResults).map((f: any) => {
    const leg = f.flights?.[0] || {};
    return {
      airline: leg.airline || "Unknown",
      departureTime: leg.departure_airport?.time || "",
      arrivalTime: leg.arrival_airport?.time || "",
      duration: `${Math.floor((f.total_duration || 0) / 60)}h${(f.total_duration || 0) % 60}m`,
      stops: (f.flights?.length || 1) - 1,
      price: f.price || null,
      currency: "USD",
      departureAirport: leg.departure_airport?.id || opts.from,
      arrivalAirport: leg.arrival_airport?.id || opts.to,
      flightNumber: leg.flight_number || "",
    };
  });

  const result = { flights, method: "serpapi_flights" };
  redisSet(cacheKey, JSON.stringify(result), 1800).catch(() => {}); // 30min cache
  return result;
}

// ─── Hotels ──────────────────────────────────────────

export interface HotelResult {
  name: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviews: number | null;
  address: string;
  amenities: string[];
  imageUrl: string | null;
  link: string;
  checkIn: string;
  checkOut: string;
}

export async function searchHotelsSerpApi(opts: {
  location: string;     // "Miami Beach" or "hotels in Miami"
  checkIn: string;      // YYYY-MM-DD
  checkOut: string;
  guests?: number;
  maxResults?: number;
}): Promise<{ hotels: HotelResult[]; method: string; fromCache?: boolean }> {
  if (!SERPAPI_KEY) return { hotels: [], method: "no_key" };

  const cacheKey = `search:hotels:${opts.location.toLowerCase()}:${opts.checkIn}:${opts.checkOut}`;
  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      console.log(`[SERPAPI-HOTELS] CACHE HIT ${opts.location}`);
      return { ...parsed, fromCache: true };
    }
  } catch {}

  const params = new URLSearchParams({
    engine: "google_hotels",
    api_key: SERPAPI_KEY,
    q: opts.location.includes("hotel") ? opts.location : `hotels in ${opts.location}`,
    check_in_date: opts.checkIn,
    check_out_date: opts.checkOut,
    adults: String(opts.guests || 1),
    currency: "USD",
    hl: "en",
  });

  console.log(`[SERPAPI-HOTELS] ${opts.location} ${opts.checkIn}→${opts.checkOut}`);

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (!res.ok) throw new Error(`SerpAPI Hotels ${res.status}`);
  const data = await res.json() as any;

  const properties = data.properties || [];
  const maxResults = opts.maxResults || 5;

  const hotels: HotelResult[] = properties.slice(0, maxResults).map((h: any) => ({
    name: h.name || "",
    price: h.rate_per_night?.extracted_lowest || h.total_rate?.extracted_lowest || null,
    currency: "USD",
    rating: h.overall_rating || null,
    reviews: h.reviews || null,
    address: h.description || "",
    amenities: (h.amenities || []).slice(0, 5),
    imageUrl: h.images?.[0]?.thumbnail || null,
    link: h.link || "",
    checkIn: opts.checkIn,
    checkOut: opts.checkOut,
  }));

  const result = { hotels, method: "serpapi_hotels" };
  redisSet(cacheKey, JSON.stringify(result), 3600).catch(() => {}); // 1h cache
  return result;
}

// ─── Events ──────────────────────────────────────────

export interface EventResult {
  title: string;
  date: string;
  venue: string;
  address: string;
  price: string | null;
  link: string;
  imageUrl: string | null;
}

export async function searchEventsSerpApi(opts: {
  query: string;
  location?: string;
  maxResults?: number;
}): Promise<{ events: EventResult[]; method: string; fromCache?: boolean }> {
  if (!SERPAPI_KEY) return { events: [], method: "no_key" };

  const q = opts.location ? `${opts.query} in ${opts.location}` : opts.query;
  const cacheKey = `search:events:${q.toLowerCase()}`;
  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      console.log(`[SERPAPI-EVENTS] CACHE HIT ${q}`);
      return { ...parsed, fromCache: true };
    }
  } catch {}

  const params = new URLSearchParams({
    engine: "google_events",
    api_key: SERPAPI_KEY,
    q,
    hl: "en",
  });

  console.log(`[SERPAPI-EVENTS] "${q}"`);

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (!res.ok) throw new Error(`SerpAPI Events ${res.status}`);
  const data = await res.json() as any;

  const eventsData = data.events_results || [];
  const maxResults = opts.maxResults || 5;

  const events: EventResult[] = eventsData.slice(0, maxResults).map((e: any) => ({
    title: e.title || "",
    date: e.date?.when || "",
    venue: e.venue?.name || "",
    address: e.address?.[0] || e.venue?.address || "",
    price: e.ticket_info?.[0]?.link_type === "more info" ? null : (e.ticket_info?.[0]?.source || null),
    link: e.link || e.ticket_info?.[0]?.link || "",
    imageUrl: e.thumbnail || null,
  }));

  const result = { events, method: "serpapi_events" };
  redisSet(cacheKey, JSON.stringify(result), 3600).catch(() => {}); // 1h cache
  return result;
}
