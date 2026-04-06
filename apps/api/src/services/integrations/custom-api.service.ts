/**
 * Custom API Service — Self-configuration engine
 *
 * Allows users to register external APIs, store credentials securely (AES-256),
 * and execute HTTP requests against them. Combined with scheduled tasks,
 * this gives Sniffer full self-configuration capability.
 */

import { prisma } from "@payjarvis/database";
import { encryptPII, decryptPII } from "../vault/crypto.js";

// ─── Types ───────────────────────────────────────────

interface ServiceConfig {
  userId: string;
  name: string;
  displayName?: string;
  baseUrl: string;
  authType: "bearer" | "basic" | "api_key" | "header" | "query" | "none";
  credentials?: string; // API key, token, or "user:pass" for basic
  headersTemplate?: Record<string, string>;
  description?: string;
}

interface ApiRequestParams {
  userId: string;
  serviceName?: string; // use a configured service
  url?: string; // or direct URL
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
  queryParams?: Record<string, string>;
  timeout?: number;
}

interface AutomationConfig {
  userId: string;
  name: string;
  description?: string;
  serviceName?: string;
  triggerType: "schedule" | "manual";
  schedule?: string;
  actionMethod?: string;
  actionPath?: string;
  actionBody?: unknown;
  postProcess?: string; // LLM instruction for processing the response
}

// ─── Service Configuration ───────────────────────────

export async function configureService(config: ServiceConfig): Promise<{ success: boolean; name: string; message: string }> {
  const { userId, name, displayName, baseUrl, authType, credentials, headersTemplate, description } = config;

  // Validate
  const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    return { success: false, name: safeName, message: "base_url must start with http:// or https://" };
  }

  // Block internal URLs
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "169.254", "10.", "172.16", "192.168"];
  const urlLower = baseUrl.toLowerCase();
  if (blocked.some(b => urlLower.includes(b))) {
    return { success: false, name: safeName, message: "Cannot configure internal/private network URLs" };
  }

  // Encrypt credentials
  const credEnc = credentials ? encryptPII(credentials) : null;

  await prisma.$executeRaw`
    INSERT INTO user_services (user_id, name, display_name, base_url, auth_type, credentials_enc, headers_template, description, updated_at)
    VALUES (${userId}, ${safeName}, ${displayName || name}, ${baseUrl}, ${authType}, ${credEnc}, ${JSON.stringify(headersTemplate || {})}::jsonb, ${description || null}, now())
    ON CONFLICT (user_id, name) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      base_url = EXCLUDED.base_url,
      auth_type = EXCLUDED.auth_type,
      credentials_enc = EXCLUDED.credentials_enc,
      headers_template = EXCLUDED.headers_template,
      description = EXCLUDED.description,
      is_active = true,
      updated_at = now()
  `;

  return { success: true, name: safeName, message: `Service "${displayName || name}" configured. You can now use api_request with service_name="${safeName}".` };
}

export async function listServices(userId: string): Promise<{ services: Array<{ name: string; displayName: string; baseUrl: string; authType: string; description: string | null; isActive: boolean; lastUsedAt: Date | null }> }> {
  const rows = await prisma.$queryRaw<Array<{
    name: string;
    display_name: string;
    base_url: string;
    auth_type: string;
    description: string | null;
    is_active: boolean;
    last_used_at: Date | null;
  }>>`
    SELECT name, display_name, base_url, auth_type, description, is_active, last_used_at
    FROM user_services
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;

  return {
    services: rows.map(r => ({
      name: r.name,
      displayName: r.display_name,
      baseUrl: r.base_url,
      authType: r.auth_type,
      description: r.description,
      isActive: r.is_active,
      lastUsedAt: r.last_used_at,
    })),
  };
}

export async function deleteService(userId: string, name: string): Promise<{ success: boolean; message: string }> {
  const result = await prisma.$executeRaw`
    DELETE FROM user_services WHERE user_id = ${userId} AND name = ${name}
  `;
  return result > 0
    ? { success: true, message: `Service "${name}" deleted.` }
    : { success: false, message: `Service "${name}" not found.` };
}

// ─── API Request Execution ──────────────────────────

export async function executeApiRequest(params: ApiRequestParams): Promise<{ success: boolean; status?: number; data?: unknown; error?: string }> {
  const { userId, serviceName, method = "GET", path = "", headers = {}, body, queryParams, timeout = 15000 } = params;

  let finalUrl: string;
  let finalHeaders: Record<string, string> = { ...headers };

  if (serviceName) {
    // Load service config
    const rows = await prisma.$queryRaw<Array<{
      base_url: string;
      auth_type: string;
      credentials_enc: string | null;
      headers_template: Record<string, string>;
    }>>`
      SELECT base_url, auth_type, credentials_enc, headers_template
      FROM user_services
      WHERE user_id = ${userId} AND name = ${serviceName} AND is_active = true
    `;

    if (rows.length === 0) {
      return { success: false, error: `Service "${serviceName}" not found or inactive. Use configure_service first.` };
    }

    const svc = rows[0];
    finalUrl = svc.base_url.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);

    // Apply stored headers
    if (svc.headers_template && typeof svc.headers_template === "object") {
      finalHeaders = { ...svc.headers_template, ...finalHeaders };
    }

    // Apply auth
    if (svc.credentials_enc) {
      const cred = decryptPII(svc.credentials_enc);
      switch (svc.auth_type) {
        case "bearer":
          finalHeaders["Authorization"] = `Bearer ${cred}`;
          break;
        case "basic":
          finalHeaders["Authorization"] = `Basic ${Buffer.from(cred).toString("base64")}`;
          break;
        case "api_key":
          finalHeaders["X-API-Key"] = cred;
          break;
        case "header": {
          // Format: "Header-Name: value"
          const idx = cred.indexOf(":");
          if (idx > 0) {
            finalHeaders[cred.substring(0, idx).trim()] = cred.substring(idx + 1).trim();
          }
          break;
        }
        case "query": {
          // Format: "param_name=value"
          const eqIdx = cred.indexOf("=");
          if (eqIdx > 0) {
            const sep = finalUrl.includes("?") ? "&" : "?";
            finalUrl += `${sep}${cred}`;
          }
          break;
        }
      }
    }

    // Update last_used
    prisma.$executeRaw`UPDATE user_services SET last_used_at = now() WHERE user_id = ${userId} AND name = ${serviceName}`.catch(() => {});
  } else if (params.url) {
    finalUrl = params.url;
  } else {
    return { success: false, error: "Provide either service_name or url" };
  }

  // Block internal URLs at execution time too
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.", "10.", "172.16.", "192.168."];
  if (blocked.some(b => finalUrl.toLowerCase().includes(b))) {
    return { success: false, error: "Cannot access internal/private network URLs" };
  }

  // Add query params
  if (queryParams) {
    const qs = new URLSearchParams(queryParams).toString();
    finalUrl += (finalUrl.includes("?") ? "&" : "?") + qs;
  }

  // Set default content-type for POST/PUT/PATCH with body
  if (body && !finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
    finalHeaders["Content-Type"] = "application/json";
  }

  try {
    const fetchOpts: RequestInit = {
      method: method.toUpperCase(),
      headers: finalHeaders,
      signal: AbortSignal.timeout(timeout),
    };

    if (body && method.toUpperCase() !== "GET") {
      fetchOpts.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const res = await fetch(finalUrl, fetchOpts);
    const contentType = res.headers.get("content-type") || "";

    let data: unknown;
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      // Truncate large responses
      data = text.length > 10000 ? text.substring(0, 10000) + "\n... (truncated)" : text;
    }

    return { success: res.ok, status: res.status, data };
  } catch (err) {
    return { success: false, error: `Request failed: ${(err as Error).message}` };
  }
}

// ─── Automations ─────────────────────────────────────

export async function configureAutomation(config: AutomationConfig): Promise<{ success: boolean; name: string; message: string }> {
  const { userId, name, description, serviceName, triggerType, schedule, actionMethod, actionPath, actionBody, postProcess } = config;

  const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

  await prisma.$executeRaw`
    INSERT INTO user_automations (user_id, name, description, service_name, trigger_type, schedule, action_method, action_path, action_body, post_process, updated_at)
    VALUES (${userId}, ${safeName}, ${description || null}, ${serviceName || null}, ${triggerType}, ${schedule || null}, ${actionMethod || "GET"}, ${actionPath || null}, ${actionBody ? JSON.stringify(actionBody) : null}::jsonb, ${postProcess || null}, now())
    ON CONFLICT (user_id, name) DO UPDATE SET
      description = EXCLUDED.description,
      service_name = EXCLUDED.service_name,
      trigger_type = EXCLUDED.trigger_type,
      schedule = EXCLUDED.schedule,
      action_method = EXCLUDED.action_method,
      action_path = EXCLUDED.action_path,
      action_body = EXCLUDED.action_body,
      post_process = EXCLUDED.post_process,
      is_active = true,
      updated_at = now()
  `;

  return { success: true, name: safeName, message: `Automation "${name}" configured${schedule ? ` (schedule: ${schedule})` : ""}.` };
}

export async function listAutomations(userId: string): Promise<{ automations: Array<{ name: string; description: string | null; serviceName: string | null; triggerType: string; schedule: string | null; isActive: boolean; lastRunAt: Date | null }> }> {
  const rows = await prisma.$queryRaw<Array<{
    name: string;
    description: string | null;
    service_name: string | null;
    trigger_type: string;
    schedule: string | null;
    is_active: boolean;
    last_run_at: Date | null;
  }>>`
    SELECT name, description, service_name, trigger_type, schedule, is_active, last_run_at
    FROM user_automations
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;

  return {
    automations: rows.map(r => ({
      name: r.name,
      description: r.description,
      serviceName: r.service_name,
      triggerType: r.trigger_type,
      schedule: r.schedule,
      isActive: r.is_active,
      lastRunAt: r.last_run_at,
    })),
  };
}

export async function runAutomation(userId: string, name: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const rows = await prisma.$queryRaw<Array<{
    service_name: string | null;
    action_method: string;
    action_path: string | null;
    action_body: unknown;
  }>>`
    SELECT service_name, action_method, action_path, action_body
    FROM user_automations
    WHERE user_id = ${userId} AND name = ${name} AND is_active = true
  `;

  if (rows.length === 0) {
    return { success: false, error: `Automation "${name}" not found or inactive.` };
  }

  const auto = rows[0];
  const result = await executeApiRequest({
    userId,
    serviceName: auto.service_name || undefined,
    method: auto.action_method,
    path: auto.action_path || "",
    body: auto.action_body,
  });

  // Update last run
  await prisma.$executeRaw`
    UPDATE user_automations SET last_run_at = now(), last_result = ${JSON.stringify(result)}::jsonb WHERE user_id = ${userId} AND name = ${name}
  `;

  return result;
}

export async function deleteAutomation(userId: string, name: string): Promise<{ success: boolean; message: string }> {
  const result = await prisma.$executeRaw`
    DELETE FROM user_automations WHERE user_id = ${userId} AND name = ${name}
  `;
  return result > 0
    ? { success: true, message: `Automation "${name}" deleted.` }
    : { success: false, message: `Automation "${name}" not found.` };
}
