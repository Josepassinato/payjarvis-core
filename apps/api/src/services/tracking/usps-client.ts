/**
 * USPS Tracking Client
 *
 * Uses USPS Web Tools API v3 with OAuth2 authentication.
 * Requires USPS_CLIENT_ID and USPS_CLIENT_SECRET env vars.
 */

export interface USPSEvent {
  date: string;
  time: string;
  location: string;
  status: string;
  description: string;
}

export interface USPSTrackingResult {
  success: boolean;
  code: string;
  events: USPSEvent[];
  estimatedDelivery?: string;
  error?: string;
}

const USPS_BASE =
  process.env.USPS_ENV === "production"
    ? "https://apis.usps.com"
    : "https://apis-tem.usps.com";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const clientId = process.env.USPS_CLIENT_ID;
  const clientSecret = process.env.USPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("USPS_CLIENT_ID and USPS_CLIENT_SECRET required");
  }

  // Use cached token if still valid (5 min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 300000) {
    return cachedToken.token;
  }

  const res = await fetch(`${USPS_BASE}/oauth2/v3/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`USPS OAuth failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

export function isUSPSConfigured(): boolean {
  return !!(process.env.USPS_CLIENT_ID && process.env.USPS_CLIENT_SECRET);
}

export async function trackUSPS(code: string): Promise<USPSTrackingResult> {
  if (!isUSPSConfigured()) {
    return {
      success: false,
      code,
      events: [],
      error: "USPS not configured (missing USPS_CLIENT_ID/USPS_CLIENT_SECRET)",
    };
  }

  try {
    const token = await getAccessToken();

    const res = await fetch(
      `${USPS_BASE}/tracking/v3/tracking/${encodeURIComponent(code)}?expand=DETAIL`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) {
      return {
        success: false,
        code,
        events: [],
        error: `USPS API returned ${res.status}`,
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    return parseUSPSResponse(code, data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, code, events: [], error: message };
  }
}

function parseUSPSResponse(
  code: string,
  data: Record<string, unknown>
): USPSTrackingResult {
  try {
    const tracking = (data as any)?.trackingNumber ?? (data as any)?.tracking;
    const trackDetail =
      tracking?.trackDetail ?? tracking?.trackingEvents ?? [];
    const summary = tracking?.trackSummary ?? null;

    const events: USPSEvent[] = [];

    // Add summary as first event if exists
    if (summary) {
      events.push({
        date: summary.eventDate ?? "",
        time: summary.eventTime ?? "",
        location: [summary.eventCity, summary.eventState, summary.eventZIPCode]
          .filter(Boolean)
          .join(", "),
        status: summary.event ?? "",
        description: summary.eventDescription ?? summary.event ?? "",
      });
    }

    // Add detail events
    const details = Array.isArray(trackDetail) ? trackDetail : [trackDetail];
    for (const e of details) {
      if (!e) continue;
      events.push({
        date: e.eventDate ?? "",
        time: e.eventTime ?? "",
        location: [e.eventCity, e.eventState, e.eventZIPCode]
          .filter(Boolean)
          .join(", "),
        status: e.event ?? "",
        description: e.eventDescription ?? e.event ?? "",
      });
    }

    const estimatedDelivery =
      tracking?.expectedDeliveryDate ??
      tracking?.predictedDeliveryDate ??
      undefined;

    return {
      success: events.length > 0,
      code,
      events,
      estimatedDelivery,
    };
  } catch {
    return {
      success: false,
      code,
      events: [],
      error: "Failed to parse USPS response",
    };
  }
}
