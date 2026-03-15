/**
 * Greyhound Client (FlixBus Wrapper)
 *
 * Greyhound was acquired by FlixBus in 2021 and operates on the same
 * infrastructure. This client wraps flixbus-client, filtering results
 * to Greyhound-branded US routes only.
 *
 * Requires env vars:
 *  - FLIXBUS_API_KEY (shared with FlixBus)
 */

import {
  searchTrips as flixSearchTrips,
  searchCities,
  isConfigured as flixIsConfigured,
  type BusTrip,
  type BusStation,
} from "./flixbus-client.js";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { BusTrip, BusStation };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if Greyhound (FlixBus) API credentials are configured.
 */
export function isConfigured(): boolean {
  return flixIsConfigured();
}

/**
 * Search for Greyhound bus trips between two locations.
 * Wraps FlixBus search and filters to Greyhound-branded routes.
 */
export async function searchTrips(
  origin: string,
  destination: string,
  date: string,
  passengers: number = 1
): Promise<BusTrip[]> {
  if (!isConfigured()) return [];

  try {
    // Resolve city names to FlixBus city IDs
    const [originCities, destCities] = await Promise.all([
      searchCities(origin),
      searchCities(destination),
    ]);

    if (originCities.length === 0 || destCities.length === 0) {
      console.error(
        "[greyhound] Could not resolve cities:",
        { origin, destination, originCities, destCities }
      );
      return [];
    }

    const originId = originCities[0].id;
    const destId = destCities[0].id;

    // Search via FlixBus API
    const allTrips = await flixSearchTrips(originId, destId, date, passengers);

    // Filter to Greyhound-only routes
    const greyhoundTrips = allTrips.filter((trip) => trip.carrier === "greyhound");

    // If no Greyhound-specific results, return all results branded as greyhound
    // since FlixBus and Greyhound share infrastructure in the US
    if (greyhoundTrips.length === 0 && allTrips.length > 0) {
      return allTrips.map((trip) => ({
        ...trip,
        carrier: "greyhound" as const,
      }));
    }

    return greyhoundTrips;
  } catch (err) {
    console.error(
      "[greyhound] searchTrips error:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Get Greyhound stations (US-only FlixBus stations).
 * Searches for major US cities to build a station list.
 */
export async function getStations(): Promise<BusStation[]> {
  if (!isConfigured()) return [];

  const usCities = [
    "New York",
    "Los Angeles",
    "Chicago",
    "Houston",
    "Phoenix",
    "Philadelphia",
    "Dallas",
    "Atlanta",
    "Miami",
    "Washington",
    "Boston",
    "Denver",
    "Seattle",
    "Orlando",
    "Las Vegas",
    "San Francisco",
  ];

  try {
    const results = await Promise.all(
      usCities.map((city) => searchCities(city))
    );

    const stations: BusStation[] = [];
    const seenIds = new Set<string>();

    for (const cities of results) {
      for (const city of cities) {
        if (city.country === "US" && !seenIds.has(city.id)) {
          seenIds.add(city.id);
          stations.push({
            id: city.id,
            name: city.name,
            city: city.name,
            state: "",
            address: "",
            lat: 0,
            lng: 0,
          });
        }
      }
    }

    return stations;
  } catch (err) {
    console.error(
      "[greyhound] getStations error:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
