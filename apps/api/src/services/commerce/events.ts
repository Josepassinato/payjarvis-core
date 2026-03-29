/**
 * Commerce Service: Events (Ticketmaster Discovery API v2)
 *
 * Auth: API key via query param
 * Base: https://app.ticketmaster.com/discovery/v2
 * Rate limit: 5000 calls/day, 5 req/second
 */

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";

function isConfigured(): boolean {
  return !!(process.env.TICKETMASTER_API_KEY && process.env.TICKETMASTER_API_KEY !== "CHANGE_ME");
}

// ─── Interfaces ──────────────────────────────────────

export interface EventSearchParams {
  city?: string;
  category?: string;      // "music", "sports", "arts", "film", "miscellaneous"
  keyword?: string;
  startDate?: string;     // YYYY-MM-DD
  endDate?: string;       // YYYY-MM-DD
  size?: number;          // max 200, default 10
  latitude?: number;      // GPS latitude for nearby search
  longitude?: number;     // GPS longitude for nearby search
}

export interface EventResult {
  id: string;
  name: string;
  date: string;
  time: string;
  venue: string;
  city: string;
  priceRange: string;
  priceMin: number;
  url: string;
  imageUrl: string;
  genre: string;
}

// ─── Search ──────────────────────────────────────────

export async function searchEvents(params: EventSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: EventResult[];
  error?: string;
}> {
  if (!isConfigured()) {
    return { source: "ticketmaster", mock: true, results: mockEvents(params) };
  }

  try {
    const query = new URLSearchParams({
      apikey: process.env.TICKETMASTER_API_KEY!,
      size: String(params.size ?? 10),
      sort: "date,asc",
    });
    // Use latlong if available, otherwise city
    if (params.latitude && params.longitude) {
      query.set("latlong", `${params.latitude},${params.longitude}`);
      query.set("radius", "50");
      query.set("unit", "km");
    } else if (params.city) {
      query.set("city", params.city);
    }
    if (params.category) query.set("classificationName", params.category);
    if (params.keyword) query.set("keyword", params.keyword);
    if (params.startDate) query.set("startDateTime", `${params.startDate}T00:00:00Z`);
    if (params.endDate) query.set("endDateTime", `${params.endDate}T23:59:59Z`);

    console.log(`[TICKETMASTER] Search: city=${params.city || 'geo'} lat=${params.latitude || ''} keyword=${params.keyword || ''}`);

    const res = await fetch(`${TM_BASE}/events.json?${query}`);
    const data = await res.json() as any;

    if (!res.ok) {
      throw new Error(data.fault?.faultstring || "Ticketmaster API error");
    }

    const events = data._embedded?.events || [];

    const results: EventResult[] = events.map((evt: any) => {
      const priceMin = evt.priceRanges?.[0]?.min || 0;
      const priceMax = evt.priceRanges?.[0]?.max;
      const priceCurrency = evt.priceRanges?.[0]?.currency || "USD";
      const priceRange = priceMin
        ? `${priceCurrency} ${priceMin}${priceMax ? ` — ${priceMax}` : ""}`
        : "See website";

      return {
        id: evt.id || '',
        name: evt.name,
        date: evt.dates?.start?.localDate || "TBD",
        time: evt.dates?.start?.localTime || "TBD",
        venue: evt._embedded?.venues?.[0]?.name || "TBD",
        city: evt._embedded?.venues?.[0]?.city?.name || params.city,
        priceRange,
        priceMin,
        url: evt.url || "",
        imageUrl: evt.images?.[0]?.url || "",
        genre: evt.classifications?.[0]?.genre?.name || evt.classifications?.[0]?.segment?.name || "General",
      };
    });

    return { source: "ticketmaster", mock: false, results };
  } catch (err) {
    console.error("[TICKETMASTER] Search error:", err instanceof Error ? err.message : err);
    return {
      source: "ticketmaster",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "Event search failed",
    };
  }
}

// ─── Event Details ───────────────────────────────────

export async function getEventDetails(eventId: string): Promise<{
  source: string;
  event: any | null;
  error?: string;
}> {
  if (!isConfigured()) {
    return { source: "ticketmaster", event: null, error: "Ticketmaster API not configured" };
  }

  try {
    const res = await fetch(`${TM_BASE}/events/${eventId}.json?apikey=${process.env.TICKETMASTER_API_KEY}`);
    const data = await res.json() as any;
    if (!res.ok) throw new Error(data.fault?.faultstring || "Event not found");
    return { source: "ticketmaster", event: data };
  } catch (err) {
    return {
      source: "ticketmaster",
      event: null,
      error: err instanceof Error ? err.message : "Failed to get event details",
    };
  }
}

// ─── Format for Telegram ─────────────────────────────

export function formatEventResults(results: EventResult[]): string {
  if (results.length === 0) {
    return "Não encontrei eventos com esses critérios. Tente outras datas ou cidade.";
  }

  const formatDate = (d: string) => {
    try {
      const date = new Date(d + 'T00:00:00');
      const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
    } catch { return d; }
  };

  const items = results.slice(0, 5).map((e, i) => {
    const parts = [
      `${i + 1}. 🎫 ${e.name}`,
      `   📅 ${formatDate(e.date)}, ${e.time.substring(0, 5)}`,
      `   📍 ${e.venue} — ${e.city}`,
      `   💰 ${e.priceRange}`,
      `   🏷️ ${e.genre}`,
    ];
    if (e.url && e.url !== '#') parts.push(`   🔗 ${e.url}`);
    return parts.join("\n");
  });

  return items.join("\n\n") + "\n\nQuer mais detalhes ou comprar ingresso? Me diga o número.";
}

// ─── Mock Data ───────────────────────────────────────

function mockEvents(p: EventSearchParams): EventResult[] {
  const city = p.city || "Nearby";
  const category = p.category || "music";
  return [
    { id: "mock-evt-001", name: `${city} Jazz Festival`, date: p.startDate || "2026-04-15", time: "20:00", venue: `${city} Arena`, city, priceRange: "USD 45 — 120", priceMin: 45, url: "#", imageUrl: "", genre: category },
    { id: "mock-evt-002", name: `${category.charAt(0).toUpperCase() + category.slice(1)} Night Live`, date: p.startDate || "2026-04-16", time: "21:00", venue: "Downtown Theater", city, priceRange: "USD 30 — 85", priceMin: 30, url: "#", imageUrl: "", genre: category },
    { id: "mock-evt-003", name: `International ${category} Show`, date: p.startDate || "2026-04-20", time: "19:30", venue: "Convention Center", city, priceRange: "USD 55 — 200", priceMin: 55, url: "#", imageUrl: "", genre: category },
  ];
}
