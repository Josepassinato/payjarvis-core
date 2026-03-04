/**
 * Extracts a BDIT token from various sources:
 * - Authorization header (Bearer token)
 * - X-BDIT-Token header
 * - Cookie named "bdit_token"
 * - Request body field "bditToken"
 */

interface ExtractSource {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}

export function extractBditToken(source: ExtractSource): string | null {
  // 1. Authorization header
  const authHeader = source.headers?.["authorization"] ?? source.headers?.["Authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // 2. X-BDIT-Token header
  const bditHeader = source.headers?.["x-bdit-token"] ?? source.headers?.["X-BDIT-Token"];
  if (typeof bditHeader === "string") {
    return bditHeader;
  }

  // 3. Cookie
  const cookieToken = source.cookies?.["bdit_token"];
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }

  // 4. Body
  const bodyToken = source.body?.["bditToken"];
  if (typeof bodyToken === "string" && bodyToken.length > 0) {
    return bodyToken;
  }

  return null;
}
