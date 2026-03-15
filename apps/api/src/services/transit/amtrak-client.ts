/**
 * Amtrak API Client
 *
 * Provides train trip search, station lookup, and real-time train status
 * via the free Amtraker API (no key required), with browser-agent scraping fallback.
 *
 * Optional env vars:
 *  - AMTRAK_API_KEY (for official API — not required for free endpoints)
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface AmtrakTrip {
  trainNumber: string;
  trainName: string;
  origin: string;
  destination: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  price: number;
  coachPrice: number;
  businessPrice: number;
  sleeperPrice: number;
  availableSeats: number;
  amenities: string[];
}

export interface AmtrakStation {
  code: string;
  name: string;
  city: string;
  state: string;
  address: string;
  lat: number;
  lng: number;
  hasParking: boolean;
  hasWifi: boolean;
  hasCheckedBaggage: boolean;
}

export interface TrainStatus {
  trainNumber: string;
  status: string;
  scheduledDepart: string;
  estimatedDepart: string;
  delayMinutes: number;
  currentLocation: string;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AMTRAKER_BASE = "https://api.amtraker.com/v1";
const AMTRAK_OFFICIAL_BASE = "https://api.amtrak.com/v1";
const BROWSER_AGENT_BASE = "http://localhost:3003/api/scrape";
const REQUEST_TIMEOUT = 15_000;

/**
 * Map of common city names / aliases to Amtrak station codes.
 */
const STATION_ALIASES: Record<string, string> = {
  miami: "MIA",
  "new york": "NYP",
  nyc: "NYP",
  washington: "WAS",
  dc: "WAS",
  chicago: "CHI",
  "los angeles": "LAX",
  orlando: "ORL",
  philadelphia: "PHL",
  boston: "BOS",
  "san francisco": "SFC",
  seattle: "SEA",
  denver: "DEN",
  atlanta: "ATL",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string | null {
  return process.env.AMTRAK_API_KEY ?? null;
}

/**
 * Check if Amtrak client is ready. Always true — free Amtraker API needs no key.
 */
export function isConfigured(): boolean {
  return true;
}

/** Whether the official Amtrak API key is available. */
function hasOfficialApi(): boolean {
  return !!process.env.AMTRAK_API_KEY;
}

/**
 * Resolve a city name or alias to an Amtrak station code.
 * Returns the input uppercased if no alias match is found.
 */
export function resolveStation(query: string): string {
  const normalized = query.trim().toLowerCase();
  if (STATION_ALIASES[normalized]) {
    return STATION_ALIASES[normalized];
  }
  // If the query is already a 3-letter code, return uppercased
  if (/^[a-zA-Z]{3}$/.test(query.trim())) {
    return query.trim().toUpperCase();
  }
  // Partial match against alias keys
  for (const [alias, code] of Object.entries(STATION_ALIASES)) {
    if (alias.includes(normalized) || normalized.includes(alias)) {
      return code;
    }
  }
  return query.trim().toUpperCase();
}

/** Fetch from the free Amtraker API (no key needed). */
async function amtrakerFetch(path: string): Promise<unknown> {
  const url = new URL(path, AMTRAKER_BASE);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "PayJarvis/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`Amtraker API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

/** Fetch from the official Amtrak API (requires key). */
async function amtrakOfficialFetch(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const url = new URL(path, AMTRAK_OFFICIAL_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`Amtrak API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Fallback: use browser-agent scraping service when API is unavailable.
 */
async function browserAgentFallback(
  action: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(BROWSER_AGENT_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site: "amtrak", action, params }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Browser-agent scrape failed ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

function mapTrip(raw: Record<string, unknown>): AmtrakTrip {
  return {
    trainNumber: String(raw.trainNumber ?? raw.train_number ?? ""),
    trainName: String(raw.trainName ?? raw.train_name ?? ""),
    origin: String(raw.origin ?? ""),
    destination: String(raw.destination ?? ""),
    departTime: String(raw.departTime ?? raw.depart_time ?? ""),
    arriveTime: String(raw.arriveTime ?? raw.arrive_time ?? ""),
    duration: String(raw.duration ?? ""),
    price: Number(raw.price ?? raw.lowestFare ?? 0),
    coachPrice: Number(raw.coachPrice ?? raw.coach_price ?? 0),
    businessPrice: Number(raw.businessPrice ?? raw.business_price ?? 0),
    sleeperPrice: Number(raw.sleeperPrice ?? raw.sleeper_price ?? 0),
    availableSeats: Number(raw.availableSeats ?? raw.available_seats ?? 0),
    amenities: Array.isArray(raw.amenities) ? raw.amenities.map(String) : [],
  };
}

function mapStation(raw: Record<string, unknown>): AmtrakStation {
  return {
    code: String(raw.code ?? raw.stationCode ?? ""),
    name: String(raw.name ?? raw.stationName ?? ""),
    city: String(raw.city ?? ""),
    state: String(raw.state ?? ""),
    address: String(raw.address ?? ""),
    lat: Number(raw.lat ?? raw.latitude ?? 0),
    lng: Number(raw.lng ?? raw.longitude ?? 0),
    hasParking: Boolean(raw.hasParking ?? raw.parking ?? false),
    hasWifi: Boolean(raw.hasWifi ?? raw.wifi ?? false),
    hasCheckedBaggage: Boolean(raw.hasCheckedBaggage ?? raw.checkedBaggage ?? false),
  };
}

function mapTrainStatus(raw: Record<string, unknown>): TrainStatus {
  return {
    trainNumber: String(raw.trainNumber ?? raw.train_number ?? ""),
    status: String(raw.status ?? "UNKNOWN"),
    scheduledDepart: String(raw.scheduledDepart ?? raw.scheduled_depart ?? ""),
    estimatedDepart: String(raw.estimatedDepart ?? raw.estimated_depart ?? ""),
    delayMinutes: Number(raw.delayMinutes ?? raw.delay_minutes ?? 0),
    currentLocation: String(raw.currentLocation ?? raw.current_location ?? ""),
    lastUpdated: String(raw.lastUpdated ?? raw.last_updated ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search for Amtrak trips between two stations.
 * Uses the free Amtraker API to get train data, falls back to official API / browser-agent.
 */
export async function searchTrips(
  origin: string,
  destination: string,
  departDate: string,
  passengers: number = 1,
  returnDate?: string
): Promise<AmtrakTrip[]> {
  const originCode = resolveStation(origin);
  const destCode = resolveStation(destination);

  // Try the free Amtraker API first — get all trains and filter by station
  try {
    const data = (await amtrakerFetch("/trains")) as any;
    // Amtraker returns { trainNumber: [trainData] } — flatten and filter
    const allTrains: any[] = [];
    if (data && typeof data === "object") {
      for (const trainArr of Object.values(data)) {
        if (Array.isArray(trainArr)) {
          allTrains.push(...trainArr);
        }
      }
    }

    // Filter trains that stop at both origin and destination
    const matching = allTrains.filter((train: any) => {
      const stations: any[] = train?.stations ?? [];
      const originIdx = stations.findIndex(
        (s: any) => String(s?.code ?? "").toUpperCase() === originCode
      );
      const destIdx = stations.findIndex(
        (s: any) => String(s?.code ?? "").toUpperCase() === destCode
      );
      return originIdx >= 0 && destIdx >= 0 && originIdx < destIdx;
    });

    if (matching.length > 0) {
      return matching.map((t) => mapTrip(t as Record<string, unknown>));
    }
  } catch (err) {
    console.error(
      "[amtrak] Amtraker API search failed:",
      err instanceof Error ? err.message : err
    );
  }

  // Try the official API if key is available
  if (hasOfficialApi()) {
    try {
      const params: Record<string, string> = {
        origin: originCode,
        destination: destCode,
        departDate,
        passengers: String(passengers),
      };
      if (returnDate) params.returnDate = returnDate;

      const data = (await amtrakOfficialFetch("/trips/search", params)) as any;
      const trips: unknown[] = data?.trips ?? data?.data ?? [];
      return trips.map((t) => mapTrip(t as Record<string, unknown>));
    } catch (err) {
      console.error(
        "[amtrak] Official API search failed, trying browser-agent fallback:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Browser-agent fallback
  try {
    const data = (await browserAgentFallback("searchTrips", {
      origin: originCode,
      destination: destCode,
      departDate,
      passengers,
      returnDate,
    })) as any;
    const trips: unknown[] = data?.trips ?? data?.results ?? [];
    return trips.map((t) => mapTrip(t as Record<string, unknown>));
  } catch (err) {
    console.error(
      "[amtrak] browser-agent fallback failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Get all Amtrak stations.
 * Uses free Amtraker API; falls back to official API / browser-agent.
 */
export async function getStations(): Promise<AmtrakStation[]> {
  // Try free Amtraker API first
  try {
    const data = (await amtrakerFetch("/stations")) as any;
    // Amtraker returns { stationCode: stationData } — flatten
    const stationList: any[] = [];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const stationData of Object.values(data)) {
        if (Array.isArray(stationData)) {
          stationList.push(...stationData);
        } else if (stationData && typeof stationData === "object") {
          stationList.push(stationData);
        }
      }
    } else if (Array.isArray(data)) {
      stationList.push(...data);
    }

    if (stationList.length > 0) {
      return stationList.map((s) => mapStation(s as Record<string, unknown>));
    }
  } catch (err) {
    console.error(
      "[amtrak] Amtraker getStations failed:",
      err instanceof Error ? err.message : err
    );
  }

  // Try official API
  if (hasOfficialApi()) {
    try {
      const data = (await amtrakOfficialFetch("/stations")) as any;
      const stations: unknown[] = data?.stations ?? data?.data ?? [];
      return stations.map((s) => mapStation(s as Record<string, unknown>));
    } catch (err) {
      console.error(
        "[amtrak] Official API getStations failed, trying browser-agent fallback:",
        err instanceof Error ? err.message : err
      );
    }
  }

  try {
    const data = (await browserAgentFallback("getStations", {})) as any;
    const stations: unknown[] = data?.stations ?? data?.results ?? [];
    return stations.map((s) => mapStation(s as Record<string, unknown>));
  } catch (err) {
    console.error(
      "[amtrak] browser-agent fallback failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Find stations matching a search query.
 * Uses free Amtraker API for a specific station code; falls back to official / browser-agent.
 */
export async function findStation(query: string): Promise<AmtrakStation[]> {
  const code = resolveStation(query);

  // Try free Amtraker API — lookup by station code
  try {
    const data = (await amtrakerFetch(`/stations/${code}`)) as any;
    const stationList: any[] = [];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const stationData of Object.values(data)) {
        if (Array.isArray(stationData)) {
          stationList.push(...stationData);
        } else if (stationData && typeof stationData === "object") {
          stationList.push(stationData);
        }
      }
    } else if (Array.isArray(data)) {
      stationList.push(...data);
    }

    if (stationList.length > 0) {
      return stationList.map((s) => mapStation(s as Record<string, unknown>));
    }
  } catch (err) {
    console.error(
      "[amtrak] Amtraker findStation failed:",
      err instanceof Error ? err.message : err
    );
  }

  // Try official API
  if (hasOfficialApi()) {
    try {
      const data = (await amtrakOfficialFetch("/stations/search", {
        query: query.trim(),
      })) as any;
      const stations: unknown[] = data?.stations ?? data?.data ?? [];
      return stations.map((s) => mapStation(s as Record<string, unknown>));
    } catch (err) {
      console.error(
        "[amtrak] Official API findStation failed, trying browser-agent fallback:",
        err instanceof Error ? err.message : err
      );
    }
  }

  try {
    const data = (await browserAgentFallback("findStation", {
      query: query.trim(),
    })) as any;
    const stations: unknown[] = data?.stations ?? data?.results ?? [];
    return stations.map((s) => mapStation(s as Record<string, unknown>));
  } catch (err) {
    console.error(
      "[amtrak] browser-agent fallback failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Get real-time status of a specific train.
 * Uses free Amtraker API; falls back to official API / browser-agent.
 */
export async function getTrainStatus(
  trainNumber: string,
  date: string
): Promise<TrainStatus | null> {
  // Try free Amtraker API first
  try {
    const data = (await amtrakerFetch(`/trains/${trainNumber}`)) as any;
    // Amtraker returns { trainNumber: [trainData] }
    let trainData: any = null;
    if (data && typeof data === "object") {
      const values = Object.values(data);
      if (values.length > 0) {
        const arr = values[0];
        trainData = Array.isArray(arr) ? arr[0] : arr;
      }
    }

    if (trainData) {
      return mapTrainStatus(trainData as Record<string, unknown>);
    }
  } catch (err) {
    console.error(
      "[amtrak] Amtraker getTrainStatus failed:",
      err instanceof Error ? err.message : err
    );
  }

  // Try official API
  if (hasOfficialApi()) {
    try {
      const data = (await amtrakOfficialFetch(`/trains/${trainNumber}/status`, {
        date,
      })) as any;
      if (!data || (!data.trainNumber && !data.train_number && !data.status)) {
        return null;
      }
      return mapTrainStatus(data as Record<string, unknown>);
    } catch (err) {
      console.error(
        "[amtrak] Official API getTrainStatus failed, trying browser-agent fallback:",
        err instanceof Error ? err.message : err
      );
    }
  }

  try {
    const data = (await browserAgentFallback("getTrainStatus", {
      trainNumber,
      date,
    })) as any;
    if (!data || (!data.trainNumber && !data.train_number && !data.status)) {
      return null;
    }
    return mapTrainStatus(data as Record<string, unknown>);
  } catch (err) {
    console.error(
      "[amtrak] browser-agent fallback failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
