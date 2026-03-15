/**
 * Transit Service — Unified ground transportation search
 *
 * Aggregates: Amtrak (train), FlixBus (bus), Greyhound (bus)
 * Methods:
 *  - searchAllTransit: search train + bus in parallel, sort by price
 *  - compareTransitVsFlight: compare all ground modes vs flight stub
 *  - findStation: search across Amtrak + bus stations
 */

// ── Interfaces ──────────────────────────────────────────────

export interface TransitResult {
  type: "train" | "bus" | "flight";
  carrier: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  price: number;
  bookingUrl: string;
  stops: number;
  transferPoints?: string[];
  amenities?: string[];
}

export interface TransitStation {
  id: string;
  name: string;
  code: string;
  type: "train" | "bus";
  carrier: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  address?: string;
}

export interface TransitSearchParams {
  origin: string;
  destination: string;
  date: string;
  passengers?: number;
  returnDate?: string;
}

export interface TrainStatus {
  trainNumber: string;
  routeName: string;
  status: string;
  delay: number;
  lastStation: string;
  nextStation: string;
  estimatedArrival: string;
  updatedAt: string;
}

// ── Constants ───────────────────────────────────────────────

const BROWSER_AGENT_URL = "http://localhost:3003/api/scrape";

// ── Browser Agent Helper ────────────────────────────────────

async function browserAgentRequest<T>(
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

// ── Carrier Search Implementations ──────────────────────────

async function searchAmtrak(params: TransitSearchParams): Promise<TransitResult[]> {
  try {
    const trips = await browserAgentRequest<
      Array<{
        trainNumber: string;
        routeName: string;
        departTime: string;
        arriveTime: string;
        duration: string;
        price: number;
        stops: number;
        transferPoints?: string[];
        amenities?: string[];
      }>
    >("amtrak", "searchTrips", {
      origin: params.origin,
      destination: params.destination,
      date: params.date,
      passengers: params.passengers ?? 1,
    });

    return trips.map((t) => ({
      type: "train" as const,
      carrier: `Amtrak ${t.routeName}`,
      departTime: t.departTime,
      arriveTime: t.arriveTime,
      duration: t.duration,
      price: t.price,
      bookingUrl: `https://www.amtrak.com/tickets/departure.html?origin=${params.origin}&destination=${params.destination}&date=${params.date}`,
      stops: t.stops,
      transferPoints: t.transferPoints,
      amenities: t.amenities,
    }));
  } catch (err) {
    console.error("[transit-service] Amtrak search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchFlixBus(params: TransitSearchParams): Promise<TransitResult[]> {
  try {
    const trips = await browserAgentRequest<
      Array<{
        tripId: string;
        departTime: string;
        arriveTime: string;
        duration: string;
        price: number;
        stops: number;
        transferPoints?: string[];
      }>
    >("flixbus", "searchTrips", {
      origin: params.origin,
      destination: params.destination,
      date: params.date,
      passengers: params.passengers ?? 1,
    });

    return trips.map((t) => ({
      type: "bus" as const,
      carrier: "FlixBus",
      departTime: t.departTime,
      arriveTime: t.arriveTime,
      duration: t.duration,
      price: t.price,
      bookingUrl: `https://www.flixbus.com/bus-routes?route=${params.origin}-${params.destination}&date=${params.date}`,
      stops: t.stops,
      transferPoints: t.transferPoints,
    }));
  } catch (err) {
    console.error("[transit-service] FlixBus search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchGreyhound(params: TransitSearchParams): Promise<TransitResult[]> {
  try {
    const trips = await browserAgentRequest<
      Array<{
        tripId: string;
        departTime: string;
        arriveTime: string;
        duration: string;
        price: number;
        stops: number;
        transferPoints?: string[];
      }>
    >("greyhound", "searchTrips", {
      origin: params.origin,
      destination: params.destination,
      date: params.date,
      passengers: params.passengers ?? 1,
    });

    return trips.map((t) => ({
      type: "bus" as const,
      carrier: "Greyhound",
      departTime: t.departTime,
      arriveTime: t.arriveTime,
      duration: t.duration,
      price: t.price,
      bookingUrl: `https://www.greyhound.com/en-us/bus-from-${params.origin}-to-${params.destination}`,
      stops: t.stops,
      transferPoints: t.transferPoints,
    }));
  } catch (err) {
    console.error("[transit-service] Greyhound search error:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Stub flight comparison — returns estimated flight option for comparison purposes.
 * In production, integrate with a flight API (Skyscanner, Amadeus, etc.)
 */
function stubFlightEstimate(params: TransitSearchParams): TransitResult {
  return {
    type: "flight",
    carrier: "Flight Estimate",
    departTime: `${params.date}T08:00:00`,
    arriveTime: `${params.date}T10:30:00`,
    duration: "~2h 30m (estimated)",
    price: 0, // unknown without API
    bookingUrl: `https://www.google.com/travel/flights?q=flights+from+${encodeURIComponent(params.origin)}+to+${encodeURIComponent(params.destination)}+on+${params.date}`,
    stops: 0,
    amenities: ["Check Google Flights for actual prices"],
  };
}

// ── Public API ──────────────────────────────────────────────

/**
 * Search all ground transit options (train + bus) in parallel, sorted by price.
 */
export async function searchAllTransit(
  origin: string,
  destination: string,
  date: string,
  passengers = 1
): Promise<TransitResult[]> {
  const params: TransitSearchParams = { origin, destination, date, passengers };

  const [amtrakResults, flixResults, greyhoundResults] = await Promise.allSettled([
    searchAmtrak(params),
    searchFlixBus(params),
    searchGreyhound(params),
  ]);

  const allResults: TransitResult[] = [];

  if (amtrakResults.status === "fulfilled") {
    allResults.push(...amtrakResults.value);
  }
  if (flixResults.status === "fulfilled") {
    allResults.push(...flixResults.value);
  }
  if (greyhoundResults.status === "fulfilled") {
    allResults.push(...greyhoundResults.value);
  }

  // Sort by price ascending
  return allResults.sort((a, b) => a.price - b.price);
}

/**
 * Compare ground transit options versus a flight stub.
 */
export async function compareTransitVsFlight(
  origin: string,
  destination: string,
  date: string
): Promise<{
  ground: TransitResult[];
  flight: TransitResult;
  cheapestGround: TransitResult | null;
  recommendation: string;
}> {
  const ground = await searchAllTransit(origin, destination, date);
  const flight = stubFlightEstimate({ origin, destination, date });
  const cheapestGround = ground.length > 0 ? ground[0] : null;

  let recommendation = "No ground transit options found. Consider flying.";
  if (cheapestGround) {
    recommendation = `Cheapest ground option: ${cheapestGround.carrier} at $${cheapestGround.price.toFixed(2)} (${cheapestGround.duration}). Compare with flight prices on Google Flights.`;
  }

  return { ground, flight, cheapestGround, recommendation };
}

/**
 * Search for stations across all carriers.
 */
export async function findStation(
  query: string,
  type?: "amtrak" | "bus" | "all"
): Promise<TransitStation[]> {
  const searchType = type ?? "all";
  const allStations: TransitStation[] = [];

  const searches: Promise<void>[] = [];

  if (searchType === "all" || searchType === "amtrak") {
    searches.push(
      browserAgentRequest<
        Array<{ id: string; name: string; code: string; city: string; state: string; lat: number; lng: number; address?: string }>
      >("amtrak", "searchStations", { query })
        .then((stations) => {
          for (const s of stations) {
            allStations.push({
              id: s.id,
              name: s.name,
              code: s.code,
              type: "train",
              carrier: "Amtrak",
              city: s.city,
              state: s.state,
              lat: s.lat,
              lng: s.lng,
              address: s.address,
            });
          }
        })
        .catch((err) => {
          console.error("[transit-service] Amtrak station search error:", err instanceof Error ? err.message : err);
        })
    );
  }

  if (searchType === "all" || searchType === "bus") {
    searches.push(
      browserAgentRequest<
        Array<{ id: string; name: string; code: string; city: string; state: string; lat: number; lng: number; carrier: string; address?: string }>
      >("flixbus", "searchStations", { query })
        .then((stations) => {
          for (const s of stations) {
            allStations.push({
              id: s.id,
              name: s.name,
              code: s.code,
              type: "bus",
              carrier: s.carrier ?? "FlixBus",
              city: s.city,
              state: s.state,
              lat: s.lat,
              lng: s.lng,
              address: s.address,
            });
          }
        })
        .catch((err) => {
          console.error("[transit-service] FlixBus station search error:", err instanceof Error ? err.message : err);
        })
    );

    searches.push(
      browserAgentRequest<
        Array<{ id: string; name: string; code: string; city: string; state: string; lat: number; lng: number; address?: string }>
      >("greyhound", "searchStations", { query })
        .then((stations) => {
          for (const s of stations) {
            allStations.push({
              id: s.id,
              name: s.name,
              code: s.code,
              type: "bus",
              carrier: "Greyhound",
              city: s.city,
              state: s.state,
              lat: s.lat,
              lng: s.lng,
              address: s.address,
            });
          }
        })
        .catch((err) => {
          console.error("[transit-service] Greyhound station search error:", err instanceof Error ? err.message : err);
        })
    );
  }

  await Promise.allSettled(searches);

  return allStations;
}

/**
 * Get Amtrak train status by train number.
 */
export async function getTrainStatus(
  trainNumber: string,
  date?: string
): Promise<TrainStatus | null> {
  try {
    const status = await browserAgentRequest<TrainStatus>("amtrak", "getTrainStatus", {
      trainNumber,
      date: date ?? new Date().toISOString().split("T")[0],
    });
    return status;
  } catch (err) {
    console.error("[transit-service] Train status error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Stub booking handler — returns a booking reference.
 * In production, this would complete the actual booking via the carrier API.
 */
export async function bookTrip(
  type: "train" | "bus",
  tripId: string,
  passengerInfo: { firstName: string; lastName: string; email: string; phone?: string }
): Promise<{
  confirmed: boolean;
  bookingRef?: string;
  carrier: string;
  message: string;
}> {
  // Determine carrier from type/tripId
  const carrier = type === "train" ? "Amtrak" : "Bus carrier";

  try {
    const result = await browserAgentRequest<{
      bookingRef: string;
      confirmed: boolean;
      carrier: string;
    }>(type === "train" ? "amtrak" : "flixbus", "bookTrip", {
      tripId,
      passenger: passengerInfo,
    });

    return {
      confirmed: result.confirmed,
      bookingRef: result.bookingRef,
      carrier: result.carrier ?? carrier,
      message: result.confirmed
        ? `Booking confirmed: ${result.bookingRef}`
        : "Booking pending — check email for confirmation",
    };
  } catch (err) {
    console.error("[transit-service] Booking error:", err instanceof Error ? err.message : err);
    return {
      confirmed: false,
      carrier,
      message: `Booking failed: ${err instanceof Error ? err.message : "Unknown error"}. Please book directly at the carrier website.`,
    };
  }
}
