export interface HealthResult {
  ok: boolean;
  status: string;
  latencyMs: number;
}

export async function checkHealth(baseUrl?: string): Promise<HealthResult> {
  const url = (baseUrl ?? process.env.PAYJARVIS_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const start = Date.now();

  try {
    const res = await fetch(`${url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return { ok: false, status: `HTTP ${res.status}`, latencyMs };
    }

    const data = await res.json() as any;
    return {
      ok: true,
      status: data.status ?? "ok",
      latencyMs,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: err.message ?? "unreachable",
      latencyMs: Date.now() - start,
    };
  }
}
