/**
 * Commerce Service: Restaurants (Yelp Fusion + Google Places fallback + OpenTable redirect)
 *
 * Priority: Yelp → Google Places (New) → Mock
 * Yelp: https://docs.developer.yelp.com/reference/v3_business_search
 * Google Places: https://developers.google.com/maps/documentation/places/web-service
 * OpenTable: reservation via redirect link (no API key needed)
 */

import { searchPlaces, type PlaceResult } from "./google-places.js";

const YELP_BASE = "https://api.yelp.com/v3";

function isYelpConfigured(): boolean {
  return !!(process.env.YELP_API_KEY && process.env.YELP_API_KEY !== "CHANGE_ME");
}

async function yelpGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const url = `${YELP_BASE}${path}${qs ? "?" + qs : ""}`;

  console.log(`[YELP] GET ${path} params=${JSON.stringify(params)}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` },
  });
  const data = await res.json() as any;
  if (!res.ok) {
    throw new Error(data.error?.description || "Yelp API error");
  }
  return data;
}

// ─── Interfaces ──────────────────────────────────────

export interface RestaurantSearchParams {
  location?: string;
  term?: string;          // "sushi", "italian", "steakhouse"
  cuisine?: string;       // alias for term (backwards compat)
  price?: string;         // "1", "2", "1,2,3"
  priceRange?: string;    // alias for price (backwards compat)
  sort_by?: string;       // "best_match" | "rating" | "review_count" | "distance"
  limit?: number;         // max 50, default 10
  open_now?: boolean;
  radius?: number;        // meters, max 40000
  date?: string;          // YYYY-MM-DD (for open_at)
  time?: string;          // HH:MM (for open_at)
  covers?: number;        // number of people (stored, not used by Yelp)
  latitude?: number;      // GPS latitude for nearby search
  longitude?: number;     // GPS longitude for nearby search
}

export interface RestaurantResult {
  id: string;
  name: string;
  rating: number;
  price: string;
  cuisine: string;
  address: string;
  phone: string;
  url: string;
  imageUrl: string;
  reviewCount: number;
  distance: string;
  isClosed: boolean;
  transactions: string[];  // "delivery", "pickup", "restaurant_reservation"
}

export interface RestaurantDetail extends RestaurantResult {
  photos: string[];
  hours: { day: number; start: string; end: string }[];
  isOpenNow: boolean;
  reviews: ReviewItem[];
  reservationUrl: string | null;
}

export interface ReviewItem {
  userName: string;
  rating: number;
  text: string;
  timeCreated: string;
}

// ─── Search ──────────────────────────────────────────

export async function searchRestaurants(params: RestaurantSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: RestaurantResult[];
  error?: string;
}> {
  if (!isYelpConfigured()) {
    // Fallback to Google Places when Yelp is not configured
    return searchRestaurantsViaGooglePlaces(params);
  }

  try {
    const term = params.term || params.cuisine || "restaurant";
    const query: Record<string, string> = {
      term: term.includes("restaurant") ? term : `${term} restaurant`,
      limit: String(params.limit ?? 10),
      sort_by: params.sort_by || "best_match",
      categories: "restaurants,bars,cafes",
    };

    // Use lat/lng if available, otherwise fall back to location string
    if (params.latitude && params.longitude) {
      query.latitude = String(params.latitude);
      query.longitude = String(params.longitude);
    } else if (params.location) {
      query.location = params.location;
    } else {
      return { source: "yelp", mock: false, results: [], error: "Location or coordinates required" };
    }

    const price = params.price || params.priceRange;
    if (price) query.price = price;
    if (params.radius) query.radius = String(Math.min(params.radius, 40000));
    if (params.open_now) query.open_now = "true";

    // If date+time provided, use open_at
    if (params.date && params.time && !params.open_now) {
      const dt = new Date(`${params.date}T${params.time}:00`);
      if (!isNaN(dt.getTime())) {
        query.open_at = String(Math.floor(dt.getTime() / 1000));
      }
    }

    const data = await yelpGet("/businesses/search", query);

    const results: RestaurantResult[] = (data.businesses || []).map((biz: any) => ({
      id: biz.id,
      name: biz.name,
      rating: biz.rating,
      price: biz.price || "N/A",
      cuisine: (biz.categories || []).map((c: any) => c.title).join(", "),
      address: (biz.location?.display_address || []).join(", "),
      phone: biz.display_phone || "",
      url: biz.url,
      imageUrl: biz.image_url || "",
      reviewCount: biz.review_count,
      distance: biz.distance ? `${(biz.distance / 1000).toFixed(1)} km` : "N/A",
      isClosed: biz.is_closed || false,
      transactions: biz.transactions || [],
    }));

    return { source: "yelp", mock: false, results };
  } catch (err) {
    console.error("[RESTAURANTS] Search error:", err instanceof Error ? err.message : err);
    return {
      source: "yelp",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "Restaurant search failed",
    };
  }
}

// ─── Details + Reviews ───────────────────────────────

export async function getRestaurantDetails(businessId: string): Promise<{
  source: string;
  detail: RestaurantDetail | null;
  error?: string;
}> {
  if (!isYelpConfigured()) {
    return { source: "yelp", detail: mockRestaurantDetail(businessId) };
  }

  try {
    // Fetch details and reviews in parallel
    const [bizData, reviewData] = await Promise.all([
      yelpGet(`/businesses/${businessId}`),
      yelpGet(`/businesses/${businessId}/reviews`, { limit: "3", sort_by: "yelp_sort" }),
    ]);

    const biz = bizData;
    const reviews: ReviewItem[] = (reviewData.reviews || []).map((r: any) => ({
      userName: r.user?.name || "Anonymous",
      rating: r.rating,
      text: r.text,
      timeCreated: r.time_created,
    }));

    const hours = (biz.hours?.[0]?.open || []).map((h: any) => ({
      day: h.day,
      start: h.start,
      end: h.end,
    }));

    const detail: RestaurantDetail = {
      id: biz.id,
      name: biz.name,
      rating: biz.rating,
      price: biz.price || "N/A",
      cuisine: (biz.categories || []).map((c: any) => c.title).join(", "),
      address: (biz.location?.display_address || []).join(", "),
      phone: biz.display_phone || "",
      url: biz.url,
      imageUrl: biz.image_url || "",
      reviewCount: biz.review_count,
      distance: "N/A",
      isClosed: biz.is_closed || false,
      transactions: biz.transactions || [],
      photos: biz.photos || [],
      hours,
      isOpenNow: biz.hours?.[0]?.is_open_now ?? false,
      reviews,
      reservationUrl: getReservationLink(biz),
    };

    return { source: "yelp", detail };
  } catch (err) {
    console.error("[RESTAURANTS] Details error:", err instanceof Error ? err.message : err);
    return {
      source: "yelp",
      detail: null,
      error: err instanceof Error ? err.message : "Failed to get restaurant details",
    };
  }
}

// ─── OpenTable Reservation Link ──────────────────────

export function getReservationLink(
  business: any,
  covers = 2,
  dateTime?: string
): string | null {
  // 1. If Yelp says restaurant supports reservations
  const hasReservation = (business.transactions || []).includes("restaurant_reservation");

  // 2. Generate OpenTable search link as fallback
  const name = encodeURIComponent(business.name || "");
  const dt = dateTime || new Date(Date.now() + 86400000).toISOString().slice(0, 16);

  if (hasReservation || business.name) {
    return `https://www.opentable.com/s?term=${name}&covers=${covers}&dateTime=${dt}`;
  }

  return null;
}

// ─── Format for Telegram ─────────────────────────────

export function formatRestaurantResults(results: RestaurantResult[]): string {
  if (results.length === 0) {
    return "Não encontrei restaurantes com esses critérios. Tente termos diferentes ou outra localização.";
  }

  const priceEmoji = (p: string) => p || "N/A";
  const starsText = (r: number) => `⭐ ${r.toFixed(1)}`;

  const items = results.slice(0, 5).map((r, i) => {
    const parts = [
      `${i + 1}. 🍽️ ${r.name} (${starsText(r.rating)} — ${r.reviewCount} reviews)`,
      `   📍 ${r.address}`,
      `   💰 ${priceEmoji(r.price)}`,
      `   🏷️ ${r.cuisine}`,
    ];
    if (r.phone) parts.push(`   📞 ${r.phone}`);
    if (r.transactions.includes("delivery")) parts.push("   🛵 Delivery disponível");
    if (r.transactions.includes("restaurant_reservation")) parts.push("   📋 Aceita reservas");
    return parts.join("\n");
  });

  return items.join("\n\n") + "\n\nQuer mais detalhes ou reservar algum? Me diga o número.";
}

export function formatRestaurantDetail(detail: RestaurantDetail): string {
  const starsText = `⭐ ${detail.rating.toFixed(1)} (${detail.reviewCount} reviews)`;
  const status = detail.isOpenNow ? "✅ Aberto agora" : "❌ Fechado";

  const parts = [
    `🍽️ ${detail.name}`,
    starsText,
    `📍 ${detail.address}`,
    `💰 ${detail.price}`,
    `🏷️ ${detail.cuisine}`,
    status,
  ];
  if (detail.phone) parts.push(`📞 ${detail.phone}`);

  // Reviews
  if (detail.reviews.length > 0) {
    parts.push("", "💬 Reviews:");
    for (const rev of detail.reviews) {
      const stars = "⭐".repeat(Math.min(rev.rating, 5));
      parts.push(`  ${stars} — ${rev.userName}`);
      parts.push(`  "${rev.text.substring(0, 120)}${rev.text.length > 120 ? "..." : ""}"`);
    }
  }

  // Reservation link
  if (detail.reservationUrl) {
    parts.push("", `📋 Reservar: ${detail.reservationUrl}`);
  }

  parts.push("", `🔗 Ver no Yelp: ${detail.url}`);

  return parts.join("\n");
}

// ─── Google Places Fallback ──────────────────────────

async function searchRestaurantsViaGooglePlaces(params: RestaurantSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: RestaurantResult[];
  error?: string;
}> {
  const term = params.term || params.cuisine || "restaurant";
  const query = params.location
    ? `${term} ${params.location}`
    : term;

  const placesResult = await searchPlaces({
    query: params.latitude && params.longitude ? term : query,
    latitude: params.latitude,
    longitude: params.longitude,
    radius: params.radius || 5000,
    type: "restaurant",
    maxResults: params.limit || 10,
    openNow: params.open_now,
  });

  if (placesResult.mock) {
    // Google Places also not configured — return mock
    return { source: "google_places", mock: true, results: mockRestaurants(params) };
  }

  if (placesResult.error || placesResult.results.length === 0) {
    if (placesResult.error) {
      console.warn(`[RESTAURANTS] Google Places fallback error: ${placesResult.error}`);
    }
    // If Google Places failed too, return mock data so the bot has something to show
    return {
      source: "google_places",
      mock: true,
      results: mockRestaurants(params),
      error: placesResult.error,
    };
  }

  // Convert PlaceResult to RestaurantResult format
  const results: RestaurantResult[] = placesResult.results.map((p: PlaceResult) => ({
    id: p.placeId,
    name: p.name,
    rating: p.rating,
    price: p.priceLevel || "N/A",
    cuisine: p.types
      .filter(t => !["point_of_interest", "establishment", "food"].includes(t))
      .map(t => t.replace(/_/g, " "))
      .slice(0, 3)
      .join(", ") || "Restaurant",
    address: p.address,
    phone: "",
    url: p.googleMapsUrl,
    imageUrl: p.photos[0] || "",
    reviewCount: p.totalRatings,
    distance: p.distance || "N/A",
    isClosed: p.isOpen === null ? false : !p.isOpen,
    transactions: [],
  }));

  return { source: "google_places", mock: false, results };
}

// ─── Mock Data ───────────────────────────────────────

function mockRestaurants(p: RestaurantSearchParams): RestaurantResult[] {
  const cuisine = p.term || p.cuisine || "Italian";
  return [
    {
      id: "mock-rest-001", name: `Trattoria Bella ${cuisine}`, rating: 4.5, price: "$$",
      cuisine, address: `123 Main St, ${p.location || "Nearby"}`, phone: "(555) 123-4567",
      url: "#", imageUrl: "", reviewCount: 342, distance: "0.8 km",
      isClosed: false, transactions: ["delivery", "restaurant_reservation"],
    },
    {
      id: "mock-rest-002", name: `${cuisine} Garden`, rating: 4.2, price: "$$$",
      cuisine, address: `456 Oak Ave, ${p.location || "Nearby"}`, phone: "(555) 987-6543",
      url: "#", imageUrl: "", reviewCount: 218, distance: "1.2 km",
      isClosed: false, transactions: ["delivery", "pickup"],
    },
    {
      id: "mock-rest-003", name: `Casa de ${cuisine}`, rating: 4.8, price: "$$$$",
      cuisine, address: `789 Elm Blvd, ${p.location || "Nearby"}`, phone: "(555) 456-7890",
      url: "#", imageUrl: "", reviewCount: 567, distance: "2.1 km",
      isClosed: false, transactions: ["restaurant_reservation"],
    },
  ];
}

function mockRestaurantDetail(businessId: string): RestaurantDetail {
  return {
    id: businessId, name: "Mock Restaurant", rating: 4.5, price: "$$",
    cuisine: "Italian, Pizza", address: "123 Main St, Miami, FL",
    phone: "(305) 555-1234", url: "#", imageUrl: "", reviewCount: 342,
    distance: "N/A", isClosed: false, transactions: ["restaurant_reservation"],
    photos: [], hours: [{ day: 0, start: "1100", end: "2200" }],
    isOpenNow: true,
    reviews: [
      { userName: "John D.", rating: 5, text: "Amazing food and great atmosphere! The pasta was perfect.", timeCreated: "2026-03-01" },
      { userName: "Maria S.", rating: 4, text: "Good Italian food, slightly pricey but worth it.", timeCreated: "2026-02-15" },
    ],
    reservationUrl: `https://www.opentable.com/s?term=Mock+Restaurant&covers=2`,
  };
}
