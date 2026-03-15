/**
 * Tracking Service — Auto-detect carrier and track packages
 *
 * Priority:
 * 1. Correios — for BR format codes
 * 2. USPS — for US format codes
 * 3. Generic detection by pattern (FedEx, UPS, Amazon)
 * 4. Browse fallback (Layer 4) — last resort
 */

import { trackCorreios } from "./correios-client.js";
import { trackUSPS, isUSPSConfigured } from "./usps-client.js";

// ─── Types ──────────────────────────────────────────

export interface TrackingEvent {
  date: string;
  time: string;
  location: string;
  status: string;
  description: string;
  destination?: string;
}

export type TrackingStatus =
  | "em_transito"
  | "entregue"
  | "saiu_para_entrega"
  | "aguardando"
  | "problema"
  | "desconhecido";

export interface TrackingResult {
  success: boolean;
  carrier: string;
  trackingCode: string;
  status: TrackingStatus;
  statusLabel: string;
  lastEvent: TrackingEvent | null;
  estimatedDelivery: string | null;
  eventsHistory: TrackingEvent[];
  trackingUrl: string;
  error?: string;
}

// ─── Carrier Detection ──────────────────────────────

type CarrierType =
  | "correios"
  | "usps"
  | "fedex"
  | "ups"
  | "amazon"
  | "dhl"
  | "unknown";

const CARRIER_PATTERNS: Array<{ carrier: CarrierType; regex: RegExp }> = [
  { carrier: "correios", regex: /^[A-Z]{2}\d{9}BR$/i },
  { carrier: "usps", regex: /^(9[234]\d{18,22}|7\d{19}|82\d{8})$/ },
  { carrier: "amazon", regex: /^TBA\d{12,}$/i },
  { carrier: "fedex", regex: /^\d{12,15}$/ },
  { carrier: "ups", regex: /^1Z[A-Z0-9]{16}$/i },
  { carrier: "dhl", regex: /^\d{10,11}$/ },
];

export function detectCarrier(code: string): CarrierType {
  const cleaned = code.trim().replace(/\s/g, "");
  for (const { carrier, regex } of CARRIER_PATTERNS) {
    if (regex.test(cleaned)) return carrier;
  }
  return "unknown";
}

// ─── Tracking URLs ──────────────────────────────────

function getTrackingUrl(carrier: CarrierType, code: string): string {
  switch (carrier) {
    case "correios":
      return `https://rastreamento.correios.com.br/app/index.php?objetos=${code}`;
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${code}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${code}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${code}`;
    case "amazon":
      return `https://track.amazon.com/tracking/${code}`;
    case "dhl":
      return `https://www.dhl.com/br-pt/home/rastreamento.html?tracking-id=${code}`;
    default:
      return `https://parcelsapp.com/pt/tracking/${code}`;
  }
}

// ─── Status Mapping ─────────────────────────────────

const STATUS_LABELS: Record<TrackingStatus, string> = {
  em_transito: "Em Trânsito",
  entregue: "Entregue",
  saiu_para_entrega: "Saiu para Entrega",
  aguardando: "Aguardando",
  problema: "Problema",
  desconhecido: "Desconhecido",
};

function mapCorreiosStatus(codigo: string, descricao: string): TrackingStatus {
  const lower = (codigo + " " + descricao).toLowerCase();
  if (
    lower.includes("entregue") ||
    lower.includes("delivered") ||
    codigo === "BDE"
  )
    return "entregue";
  if (
    lower.includes("saiu para entrega") ||
    lower.includes("out for delivery") ||
    codigo === "OEC"
  )
    return "saiu_para_entrega";
  if (
    lower.includes("postado") ||
    lower.includes("aguardando") ||
    codigo === "PO"
  )
    return "aguardando";
  if (
    lower.includes("devolvido") ||
    lower.includes("extraviado") ||
    lower.includes("apreend") ||
    lower.includes("tribut")
  )
    return "problema";
  if (
    lower.includes("transito") ||
    lower.includes("encaminhado") ||
    lower.includes("recebido") ||
    lower.includes("objeto")
  )
    return "em_transito";
  return "em_transito";
}

function mapUSPSStatus(event: string): TrackingStatus {
  const lower = event.toLowerCase();
  if (lower.includes("delivered")) return "entregue";
  if (lower.includes("out for delivery")) return "saiu_para_entrega";
  if (lower.includes("accepted") || lower.includes("pre-shipment"))
    return "aguardando";
  if (
    lower.includes("alert") ||
    lower.includes("exception") ||
    lower.includes("return")
  )
    return "problema";
  return "em_transito";
}

// ─── Main Track Function ────────────────────────────

export async function trackPackage(code: string): Promise<TrackingResult> {
  const cleaned = code.trim().replace(/\s/g, "");
  const carrier = detectCarrier(cleaned);
  const trackingUrl = getTrackingUrl(carrier, cleaned);

  // ── Correios ─────────────────────────────────────
  if (carrier === "correios") {
    const result = await trackCorreios(cleaned);

    if (!result.success || result.events.length === 0) {
      return {
        success: false,
        carrier: "Correios",
        trackingCode: cleaned,
        status: "desconhecido",
        statusLabel: STATUS_LABELS.desconhecido,
        lastEvent: null,
        estimatedDelivery: null,
        eventsHistory: [],
        trackingUrl,
        error: result.error ?? "Nenhum evento encontrado",
      };
    }

    const lastEvent = result.events[0];
    const status = mapCorreiosStatus(lastEvent.status, lastEvent.description);

    return {
      success: true,
      carrier: "Correios",
      trackingCode: cleaned,
      status,
      statusLabel: STATUS_LABELS[status],
      lastEvent: {
        date: lastEvent.date,
        time: lastEvent.time,
        location: lastEvent.location,
        status: lastEvent.status,
        description: lastEvent.description,
        destination: lastEvent.destination,
      },
      estimatedDelivery: null,
      eventsHistory: result.events.map((e) => ({
        date: e.date,
        time: e.time,
        location: e.location,
        status: e.status,
        description: e.description,
        destination: e.destination,
      })),
      trackingUrl,
    };
  }

  // ── USPS ─────────────────────────────────────────
  if (carrier === "usps" && isUSPSConfigured()) {
    const result = await trackUSPS(cleaned);

    if (!result.success || result.events.length === 0) {
      return {
        success: false,
        carrier: "USPS",
        trackingCode: cleaned,
        status: "desconhecido",
        statusLabel: STATUS_LABELS.desconhecido,
        lastEvent: null,
        estimatedDelivery: null,
        eventsHistory: [],
        trackingUrl,
        error: result.error ?? "No events found",
      };
    }

    const lastEvent = result.events[0];
    const status = mapUSPSStatus(lastEvent.status);

    return {
      success: true,
      carrier: "USPS",
      trackingCode: cleaned,
      status,
      statusLabel: STATUS_LABELS[status],
      lastEvent: {
        date: lastEvent.date,
        time: lastEvent.time,
        location: lastEvent.location,
        status: lastEvent.status,
        description: lastEvent.description,
      },
      estimatedDelivery: result.estimatedDelivery ?? null,
      eventsHistory: result.events.map((e) => ({
        date: e.date,
        time: e.time,
        location: e.location,
        status: e.status,
        description: e.description,
      })),
      trackingUrl,
    };
  }

  // ── Other carriers — return tracking URL for browser ──
  const carrierLabels: Record<string, string> = {
    fedex: "FedEx",
    ups: "UPS",
    amazon: "Amazon",
    dhl: "DHL",
    usps: "USPS",
    unknown: "Desconhecido",
  };

  return {
    success: false,
    carrier: carrierLabels[carrier] ?? carrier,
    trackingCode: cleaned,
    status: "desconhecido",
    statusLabel: STATUS_LABELS.desconhecido,
    lastEvent: null,
    estimatedDelivery: null,
    eventsHistory: [],
    trackingUrl,
    error: `Rastreamento direto indisponível para ${carrierLabels[carrier] ?? carrier}. Use o link: ${trackingUrl}`,
  };
}
