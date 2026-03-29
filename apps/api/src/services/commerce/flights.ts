/**
 * Commerce Service: Flights (Amadeus API)
 *
 * Auth: OAuth2 client_credentials (shared pattern with hotels.ts)
 * 401 retry, city code resolver, Telegram formatting
 */

import { resolveCityCode } from "./hotels.js";

const BASE = process.env.AMADEUS_ENV === "production"
  ? "https://api.amadeus.com"
  : "https://test.api.amadeus.com";

let token: string | null = null;
let tokenExpiry = 0;

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

  console.log(`[FLIGHTS] GET ${path} params=${JSON.stringify(params)}`);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });

  if (res.status === 401 && retry) {
    console.log("[FLIGHTS] 401 — refreshing token and retrying");
    token = null;
    tokenExpiry = 0;
    return amadeusGet(path, params, false);
  }

  const data = await res.json() as any;
  if (!res.ok) {
    throw new Error(data.detail || data.errors?.[0]?.detail || JSON.stringify(data.errors?.[0]) || "Amadeus API error");
  }
  return data;
}

// ─── Interfaces ──────────────────────────────────────

export interface FlightSearchParams {
  origin: string;         // City name or IATA code
  destination: string;    // City name or IATA code
  departureDate: string;  // YYYY-MM-DD
  returnDate?: string;
  passengers?: number;
  cabin?: string;         // ECONOMY, BUSINESS, FIRST
  maxPrice?: number;
  currency?: string;
}

export interface FlightResult {
  airline: string;
  flightNumber: string;
  departure: { airport: string; time: string };
  arrival: { airport: string; time: string };
  stops: number;
  duration: string;
  price: string;
  priceNumeric: number;
  cabin: string;
}

// ─── Search ──────────────────────────────────────────

export async function searchFlights(params: FlightSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: FlightResult[];
  error?: string;
}> {
  // Resolve city names to IATA codes
  const originCode = await resolveCityCode(params.origin);
  const destCode = await resolveCityCode(params.destination);
  console.log(`[FLIGHTS] ${params.origin}→${originCode}, ${params.destination}→${destCode}`);

  if (!isConfigured()) {
    return {
      source: "amadeus",
      mock: true,
      results: mockFlights({ ...params, origin: originCode, destination: destCode }),
    };
  }

  try {
    const query: Record<string, string> = {
      originLocationCode: originCode,
      destinationLocationCode: destCode,
      departureDate: params.departureDate,
      adults: String(params.passengers ?? 1),
      max: "8",
      currencyCode: params.currency || "USD",
    };
    if (params.returnDate) query.returnDate = params.returnDate;
    if (params.cabin) query.travelClass = params.cabin.toUpperCase();
    if (params.maxPrice) query.maxPrice = String(params.maxPrice);

    const data = await amadeusGet("/v2/shopping/flight-offers", query);

    const results: FlightResult[] = (data.data || []).map((offer: any) => {
      const itin = offer.itineraries[0];
      const firstSeg = itin.segments[0];
      const lastSeg = itin.segments[itin.segments.length - 1];
      return {
        airline: firstSeg.carrierCode,
        flightNumber: `${firstSeg.carrierCode}${firstSeg.number}`,
        departure: { airport: firstSeg.departure.iataCode, time: firstSeg.departure.at },
        arrival: { airport: lastSeg.arrival.iataCode, time: lastSeg.arrival.at },
        stops: itin.segments.length - 1,
        duration: itin.duration,
        price: `${offer.price.currency} ${offer.price.total}`,
        priceNumeric: parseFloat(offer.price.total),
        cabin: offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || params.cabin || "ECONOMY",
      };
    });

    // Sort by price
    results.sort((a, b) => a.priceNumeric - b.priceNumeric);

    return { source: "amadeus", mock: false, results: results.slice(0, 5) };
  } catch (err) {
    console.error("[FLIGHTS] Search error:", err instanceof Error ? err.message : err);
    return {
      source: "amadeus",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "Flight search failed",
    };
  }
}

// ─── Format for Telegram ─────────────────────────────

export function formatFlightResults(results: FlightResult[], origin: string, destination: string): string {
  if (results.length === 0) {
    return `Não encontrei voos de ${origin} para ${destination} nessas datas.`;
  }

  const formatDuration = (dur: string) => {
    const match = dur.match(/PT(\d+)H(\d+)?M?/);
    if (!match) return dur;
    return `${match[1]}h${match[2] ? match[2] + 'min' : ''}`;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const header = `✈️ Voos ${origin} → ${destination}\n`;

  const items = results.map((f, i) => {
    const stopsText = f.stops === 0 ? 'Direto' : `${f.stops} parada${f.stops > 1 ? 's' : ''}`;
    return [
      `${i + 1}. ${f.airline} ${f.flightNumber}`,
      `   🛫 ${f.departure.airport} ${formatTime(f.departure.time)} → ${f.arrival.airport} ${formatTime(f.arrival.time)}`,
      `   ⏱️ ${formatDuration(f.duration)} · ${stopsText}`,
      `   💰 $${f.priceNumeric.toFixed(0)} · ${f.cabin}`,
    ].join("\n");
  });

  return header + "\n" + items.join("\n\n");
}

// ─── Mock Data ───────────────────────────────────────

function mockFlights(p: FlightSearchParams): FlightResult[] {
  const cabin = p.cabin || "ECONOMY";
  return [
    {
      airline: "AA", flightNumber: "AA1234",
      departure: { airport: p.origin, time: `${p.departureDate}T08:00:00` },
      arrival: { airport: p.destination, time: `${p.departureDate}T13:30:00` },
      stops: 0, duration: "PT5H30M", price: "USD 342.00", priceNumeric: 342, cabin,
    },
    {
      airline: "DL", flightNumber: "DL567",
      departure: { airport: p.origin, time: `${p.departureDate}T06:00:00` },
      arrival: { airport: p.destination, time: `${p.departureDate}T14:15:00` },
      stops: 1, duration: "PT8H15M", price: "USD 289.00", priceNumeric: 289, cabin,
    },
    {
      airline: "UA", flightNumber: "UA2345",
      departure: { airport: p.origin, time: `${p.departureDate}T14:00:00` },
      arrival: { airport: p.destination, time: `${p.departureDate}T18:50:00` },
      stops: 0, duration: "PT4H50M", price: "USD 415.00", priceNumeric: 415, cabin,
    },
  ];
}
