/**
 * MCP Server — Exposes PayJarvis/Sniffer tools via Model Context Protocol
 *
 * This is a lightweight MCP server (JSON-RPC 2.0 over HTTP) that the
 * Grok Voice Agent connects to during live phone calls. When a user asks
 * Sniffer to search products, hotels, events etc, Grok calls these tools
 * natively via MCP — zero additional client-side code needed.
 *
 * Endpoint: POST /mcp
 * Auth: Bearer MCP_INTERNAL_TOKEN (set in .env)
 *
 * Tools exposed:
 *   - search_products(query, category?, maxPrice?, zip?)
 *   - search_hotels(city, checkin, checkout, guests?)
 *   - search_events(query, city?, date?)
 *   - search_restaurants(query, location?, cuisine?)
 *   - search_flights(origin, destination, date, returnDate?)
 *   - track_package(code)
 *   - compare_prices(product)
 */

const BASE_URL = `http://localhost:${process.env.API_PORT || 3001}`;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";
const MCP_TOKEN = process.env.MCP_INTERNAL_TOKEN || process.env.INTERNAL_SECRET || "";

// ─── Tool Definitions ────────────────────────────────

const TOOLS = [
  {
    name: "search_products",
    description: "Search for products across multiple retailers (Amazon, Walmart, Target, Macy's, Mercado Libre). Returns name, price, store, and URL.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product search query (e.g. 'iPhone 16 Pro case')" },
        category: { type: "string", description: "Category filter (electronics, clothing, grocery, etc.)" },
        maxPrice: { type: "number", description: "Maximum price in USD" },
        zip: { type: "string", description: "ZIP code for local store availability" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_hotels",
    description: "Search for hotels in a city with check-in/check-out dates. Returns hotel name, price per night, rating, and booking info.",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name (e.g. 'Miami' or 'São Paulo')" },
        checkin: { type: "string", description: "Check-in date (YYYY-MM-DD)" },
        checkout: { type: "string", description: "Check-out date (YYYY-MM-DD)" },
        guests: { type: "number", description: "Number of guests (default 2)" },
      },
      required: ["city", "checkin", "checkout"],
    },
  },
  {
    name: "search_events",
    description: "Search for events, concerts, sports, and shows. Returns event name, date, venue, and ticket prices.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Event search (e.g. 'Drake concert', 'NBA Miami Heat')" },
        city: { type: "string", description: "City to search in" },
        date: { type: "string", description: "Date or date range (YYYY-MM-DD)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_restaurants",
    description: "Search for restaurants nearby. Returns name, rating, price range, cuisine, and address.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Restaurant search (e.g. 'sushi', 'Italian dinner')" },
        location: { type: "string", description: "City or address for search radius" },
        cuisine: { type: "string", description: "Cuisine type filter" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_flights",
    description: "Search for flights between airports. Returns airline, departure time, duration, and price.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Origin airport code (e.g. 'MIA', 'GRU')" },
        destination: { type: "string", description: "Destination airport code (e.g. 'JFK', 'LAX')" },
        date: { type: "string", description: "Departure date (YYYY-MM-DD)" },
        returnDate: { type: "string", description: "Return date for round trip (YYYY-MM-DD)" },
      },
      required: ["origin", "destination", "date"],
    },
  },
  {
    name: "track_package",
    description: "Track a package by tracking code. Supports USPS, FedEx, DHL, UPS, and Correios.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Tracking number" },
      },
      required: ["code"],
    },
  },
  {
    name: "compare_prices",
    description: "Compare prices for a product across multiple stores. Returns a comparison table with prices, ratings, and links.",
    inputSchema: {
      type: "object",
      properties: {
        product: { type: "string", description: "Product name to compare (e.g. 'AirPods Pro 2')" },
        zip: { type: "string", description: "ZIP code for local pricing" },
      },
      required: ["product"],
    },
  },
];

// ─── Tool Execution ──────────────────────────────────

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  "x-internal-secret": INTERNAL_SECRET,
};

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const timeout = 15_000;

  switch (name) {
    case "search_products": {
      const res = await fetch(`${BASE_URL}/api/retail/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: args.query,
          zip: args.zip || "33401",
          maxPrice: args.maxPrice,
          category: args.category,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      const data = (await res.json()) as { results?: unknown[] };
      const items = (data.results || []).slice(0, 5);
      return { products: items, count: items.length };
    }

    case "search_hotels": {
      const res = await fetch(`${BASE_URL}/api/commerce/hotels/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          city: args.city,
          checkIn: args.checkin,
          checkOut: args.checkout,
          guests: args.guests || 2,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      const data = (await res.json()) as { hotels?: unknown[] };
      const hotels = (data.hotels || []).slice(0, 5);
      return { hotels, count: hotels.length };
    }

    case "search_events": {
      const res = await fetch(`${BASE_URL}/api/commerce/events/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: args.query,
          city: args.city,
          date: args.date,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      const data = (await res.json()) as { events?: unknown[] };
      const events = (data.events || []).slice(0, 5);
      return { events, count: events.length };
    }

    case "search_restaurants": {
      const res = await fetch(`${BASE_URL}/api/commerce/restaurants/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: args.query || args.cuisine,
          location: args.location,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      const data = (await res.json()) as { restaurants?: unknown[] };
      const restaurants = (data.restaurants || []).slice(0, 5);
      return { restaurants, count: restaurants.length };
    }

    case "search_flights": {
      const res = await fetch(`${BASE_URL}/api/commerce/flights/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          origin: args.origin,
          destination: args.destination,
          date: args.date,
          returnDate: args.returnDate,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      const data = (await res.json()) as { flights?: unknown[] };
      const flights = (data.flights || []).slice(0, 5);
      return { flights, count: flights.length };
    }

    case "track_package": {
      const res = await fetch(`${BASE_URL}/api/tracking/${encodeURIComponent(args.code as string)}`, {
        headers,
        signal: AbortSignal.timeout(timeout),
      });
      return await res.json();
    }

    case "compare_prices": {
      const res = await fetch(`${BASE_URL}/api/retail/compare`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: args.product,
          zip: args.zip || "33401",
        }),
        signal: AbortSignal.timeout(timeout),
      });
      return await res.json();
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP JSON-RPC Handler ────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResponse(id: string | number, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function handleMcpRequest(body: JsonRpcRequest): Promise<unknown> {
  const { id, method, params } = body;

  switch (method) {
    case "initialize":
      return jsonRpcResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "sniffer-tools",
          version: "1.0.0",
        },
      });

    case "tools/list":
      return jsonRpcResponse(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = (params as any)?.name as string;
      const toolArgs = (params as any)?.arguments as Record<string, unknown> || {};

      if (!toolName) {
        return jsonRpcError(id, -32602, "Missing tool name");
      }

      const tool = TOOLS.find((t) => t.name === toolName);
      if (!tool) {
        return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
      }

      try {
        console.log(`[MCP] Executing tool: ${toolName}`, JSON.stringify(toolArgs).substring(0, 200));
        const result = await executeTool(toolName, toolArgs);
        return jsonRpcResponse(id, {
          content: [
            { type: "text", text: JSON.stringify(result, null, 2) },
          ],
        });
      } catch (err) {
        console.error(`[MCP] Tool error: ${toolName}`, (err as Error).message);
        return jsonRpcError(id, -32000, `Tool execution failed: ${(err as Error).message}`);
      }
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

export function validateMcpAuth(authHeader: string | undefined): boolean {
  if (!MCP_TOKEN) return true; // no token configured = open (dev)
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return token === MCP_TOKEN;
}

export { TOOLS as MCP_TOOLS };
