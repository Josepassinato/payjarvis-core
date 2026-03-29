/**
 * Commerce Services — Central Router
 *
 * All commerce searches go through here.
 * Handles caching (Redis 5min), rate limiting (10/min/user/category),
 * and audit logging.
 */

import { redisGet, redisSet, redisIncr } from "../redis.js";
import { createAuditLog } from "../audit.js";
import { logEvent, AuditEvents } from "../../core/audit-logger.js";
import { searchFlights, type FlightSearchParams } from "./flights.js";
import { searchHotels, type HotelSearchParams } from "./hotels.js";
import { searchRestaurants, type RestaurantSearchParams } from "./restaurants.js";
import { searchEvents, type EventSearchParams } from "./events.js";
import { requestTransport, type TransportRequestParams } from "./transport.js";
import { searchDelivery, type DeliverySearchParams } from "./delivery.js";

export type CommerceService = "flights" | "hotels" | "restaurants" | "events" | "transport" | "delivery";

const CACHE_TTL = 300; // 5 minutes
const RATE_LIMIT = 10; // 10 requests per minute per user per category
const RATE_TTL = 60;   // 60 seconds window

// ─── Rate Limiting ──────────────────────────────────

async function checkRateLimit(botId: string, service: CommerceService): Promise<boolean> {
  const key = `ratelimit:commerce:${service}:${botId}`;
  const count = await redisIncr(key, RATE_TTL);
  return count <= RATE_LIMIT;
}

// ─── Cache Key ──────────────────────────────────────

function cacheKey(service: CommerceService, params: Record<string, unknown>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return `commerce:${service}:${sorted}`;
}

// ─── Generic Search with Cache + Rate Limit + Audit ─

interface CommerceSearchOptions {
  botId: string;
  service: CommerceService;
  params: Record<string, unknown>;
}

export async function commerceSearch(options: CommerceSearchOptions): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  cached?: boolean;
  rateLimited?: boolean;
}> {
  const { botId, service, params } = options;
  const startTime = Date.now();

  // Rate limit check
  const allowed = await checkRateLimit(botId, service);
  if (!allowed) {
    return {
      success: false,
      error: `Rate limit exceeded: max ${RATE_LIMIT} requests per minute for ${service}`,
      rateLimited: true,
    };
  }

  // Cache check
  const key = cacheKey(service, params);
  const cached = await redisGet(key);
  if (cached) {
    const data = JSON.parse(cached);
    const durationMs = Date.now() - startTime;

    // Audit log (async, non-blocking)
    createAuditLog({
      entityType: "commerce",
      entityId: service,
      action: `${service}.search`,
      actorType: "bot",
      actorId: botId,
      payload: { params, resultCount: data.results?.length ?? 0, cached: true, durationMs },
    }).catch(() => {});

    return { success: true, data, cached: true };
  }

  // Execute search
  let result: unknown;
  try {
    switch (service) {
      case "flights":
        result = await searchFlights(params as unknown as FlightSearchParams);
        break;
      case "hotels":
        result = await searchHotels(params as unknown as HotelSearchParams);
        break;
      case "restaurants":
        result = await searchRestaurants(params as unknown as RestaurantSearchParams);
        break;
      case "events":
        result = await searchEvents(params as unknown as EventSearchParams);
        break;
      case "transport":
        result = await requestTransport(params as unknown as TransportRequestParams);
        break;
      case "delivery":
        result = await searchDelivery(params as unknown as DeliverySearchParams);
        break;
      default:
        return { success: false, error: `Unknown service: ${service}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Commerce search failed",
    };
  }

  const durationMs = Date.now() - startTime;
  const resultCount = (result as any)?.results?.length ?? 0;

  // Cache result
  await redisSet(key, JSON.stringify(result), CACHE_TTL);

  // Audit log (async, non-blocking)
  createAuditLog({
    entityType: "commerce",
    entityId: service,
    action: `${service}.search`,
    actorType: "bot",
    actorId: botId,
    payload: { params, resultCount, cached: false, durationMs, mock: (result as any)?.mock ?? false },
  }).catch(() => {});

  // Layer 2 audit log via core audit-logger
  logEvent({
    botId,
    event: AuditEvents.API_CALL_MADE,
    layer: 2,
    payload: { service, params, resultCount, cached: false, durationMs, mock: (result as any)?.mock ?? false },
  }).catch(() => {});

  return { success: true, data: result, cached: false };
}

// Re-export types for route usage
export type { FlightSearchParams, FlightResult } from "./flights.js";
export { formatFlightResults } from "./flights.js";
export type { HotelSearchParams, HotelResult } from "./hotels.js";
export { getHotelOffer, formatHotelResults, resolveCityCode } from "./hotels.js";
export type { RestaurantSearchParams, RestaurantResult, RestaurantDetail } from "./restaurants.js";
export { getRestaurantDetails, formatRestaurantResults, formatRestaurantDetail, getReservationLink } from "./restaurants.js";
export type { EventSearchParams, EventResult } from "./events.js";
export { getEventDetails, formatEventResults } from "./events.js";
export type { TransportRequestParams } from "./transport.js";
export type { DeliverySearchParams } from "./delivery.js";
export type { MeliSearchParams, MeliProduct } from "./mercadolibre.js";
export { searchMeliProducts, getMeliProduct, formatMeliResults } from "./mercadolibre.js";
export type { EbaySearchParams, EbayProduct } from "./ebay.js";
export { searchEbayProducts, getEbayProduct, formatEbayResults } from "./ebay.js";
export type { PlacesSearchParams, PlaceResult } from "./google-places.js";
export { searchPlaces, getPlaceDetails, formatPlacesResults } from "./google-places.js";
