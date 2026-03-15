/**
 * Correios Tracking Client
 *
 * Uses the Correios ProxyApp API (mobile app endpoint)
 * to track packages in Brazil.
 */

export interface CorreiosEvent {
  date: string;
  time: string;
  location: string;
  status: string;
  description: string;
  destination?: string;
}

export interface CorreiosTrackingResult {
  success: boolean;
  code: string;
  events: CorreiosEvent[];
  error?: string;
}

const CORREIOS_API = "https://proxyapp.correios.com.br/v1/sro-rastro";

export async function trackCorreios(
  code: string
): Promise<CorreiosTrackingResult> {
  try {
    const res = await fetch(`${CORREIOS_API}/${code}`, {
      headers: {
        "User-Agent": "Correios-Android/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      // Try alternative endpoint format
      const res2 = await fetch(
        `${CORREIOS_API}/${code}?tipo=T`,
        {
          headers: {
            "User-Agent": "Correios-Android/1.0",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!res2.ok) {
        return {
          success: false,
          code,
          events: [],
          error: `Correios API returned ${res2.status}`,
        };
      }

      return parseCorreiosResponse(code, (await res2.json()) as Record<string, unknown>);
    }

    return parseCorreiosResponse(code, (await res.json()) as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, code, events: [], error: message };
  }
}

function parseCorreiosResponse(
  code: string,
  data: Record<string, unknown>
): CorreiosTrackingResult {
  try {
    // Correios API response format varies — handle multiple shapes
    const objetos = (data as any)?.objetos ?? (data as any)?.resultado ?? [];
    const objeto = Array.isArray(objetos) ? objetos[0] : objetos;

    if (!objeto) {
      return { success: false, code, events: [], error: "Objeto não encontrado" };
    }

    const eventos = (objeto.eventos ?? objeto.evento ?? []) as Array<Record<string, unknown>>;

    const events: CorreiosEvent[] = eventos.map((e: Record<string, unknown>) => {
      const unidade = e.unidade as Record<string, unknown> | undefined;
      const unidadeDestino = e.unidadeDestino as Record<string, unknown> | undefined;
      const endereco = unidade?.endereco as Record<string, unknown> | undefined;

      return {
        date: (e.dtHrCriado as string ?? e.data as string ?? "").split("T")[0],
        time: (e.dtHrCriado as string ?? "").split("T")[1]?.slice(0, 5) ?? (e.hora as string ?? ""),
        location: endereco
          ? `${endereco.cidade ?? ""} - ${endereco.uf ?? ""}`.trim()
          : (unidade?.nome as string ?? (e.local as string ?? "")),
        status: (e.codigo as string ?? e.tipo as string ?? ""),
        description: (e.descricao as string ?? e.descricaoCompleta as string ?? ""),
        destination: unidadeDestino
          ? (unidadeDestino.nome as string ?? "")
          : undefined,
      };
    });

    return { success: events.length > 0, code, events };
  } catch {
    return { success: false, code, events: [], error: "Failed to parse Correios response" };
  }
}
