// ─── Call Playbooks Service ─────────────────────────────────────────────
// Pre-defined conversation scripts for common call tasks.
// Jarvis selects the right playbook, checks required info, and follows the script.

import { prisma } from "@payjarvis/database";

// ─── Types ──────────────────────────────────────────────────────────────

interface PlaybookStep {
  step: number;
  action: string;       // what to say/do
  waitFor?: string;     // what to listen for
  fallback?: string;    // if they don't respond as expected
}

interface Objection {
  trigger: string;      // what the person says
  response: string;     // how Jarvis should respond
}

interface RequiredField {
  name: string;         // e.g. "restaurant_name"
  label: string;        // e.g. "Restaurant name"
  example?: string;     // e.g. "Olive Garden"
}

export interface Playbook {
  id: string;
  name: string;
  category: string;
  language: string;
  openingLine: string;
  requiredInfo: RequiredField[];
  scriptSteps: PlaybookStep[];
  successCriteria: string | null;
  commonObjections: Objection[];
  avgDurationSeconds: number | null;
}

// ─── Playbook Detection ─────────────────────────────────────────────────

const PLAYBOOK_KEYWORDS: Record<string, string[]> = {
  restaurant_reservation: ["reserv", "mesa", "table", "restauran", "dinner", "jantar", "almoço", "lunch"],
  appointment_booking: ["appoint", "consult", "agendar", "marcar", "schedule", "dentist", "doctor", "médico"],
  delivery_status: ["delivery", "entrega", "order status", "package", "pedido", "tracking"],
  price_inquiry: ["price", "preço", "quanto custa", "how much", "pricing", "cotação", "quote"],
  cancel_reservation: ["cancel", "cancelar", "modify", "alterar", "change reservation"],
};

/** Detect which playbook matches the user's intent */
export function detectPlaybookName(objective: string): string | null {
  const lower = objective.toLowerCase();
  for (const [name, keywords] of Object.entries(PLAYBOOK_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return name;
  }
  return null;
}

/** Find a playbook by name and language */
export async function findPlaybook(name: string, language: string = "en"): Promise<Playbook | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string; name: string; category: string; language: string;
      openingLine: string; requiredInfo: unknown; scriptSteps: unknown;
      successCriteria: string | null; commonObjections: unknown;
      avgDurationSeconds: number | null;
    }>>`
      SELECT * FROM call_playbooks
      WHERE name = ${name} AND language = ${language}
      LIMIT 1
    `;

    if (rows.length === 0) {
      // Fallback to English if requested language not found
      if (language !== "en") return findPlaybook(name, "en");
      return null;
    }

    const row = rows[0];
    return {
      ...row,
      requiredInfo: (row.requiredInfo as RequiredField[]) || [],
      scriptSteps: (row.scriptSteps as PlaybookStep[]) || [],
      commonObjections: (row.commonObjections as Objection[]) || [],
    };
  } catch {
    return null;
  }
}

/** Check which required fields are missing from the briefing */
export function getMissingInfo(playbook: Playbook, providedInfo: Record<string, string>): RequiredField[] {
  return playbook.requiredInfo.filter(f => !providedInfo[f.name] || providedInfo[f.name].trim() === "");
}

/** Build a prompt section for the playbook */
export function buildPlaybookPrompt(playbook: Playbook, info: Record<string, string>): string {
  // Replace placeholders in steps with actual values
  const filledSteps = playbook.scriptSteps.map(step => {
    let action = step.action;
    for (const [key, value] of Object.entries(info)) {
      action = action.replace(new RegExp(`\\[${key}\\]`, "gi"), value);
    }
    return `  Step ${step.step}: ${action}${step.waitFor ? ` → Wait for: ${step.waitFor}` : ""}`;
  });

  const objections = playbook.commonObjections.map(o =>
    `  If they say "${o.trigger}" → ${o.response}`
  );

  // Replace placeholders in opening line
  let opening = playbook.openingLine;
  for (const [key, value] of Object.entries(info)) {
    opening = opening.replace(new RegExp(`\\[${key}\\]`, "gi"), value);
  }

  return `
=== PLAYBOOK: ${playbook.name} (${playbook.language.toUpperCase()}) ===
TYPE: ${playbook.category}
OPENING LINE: "${opening}"

SCRIPT STEPS (follow in order, adapt naturally — NEVER read verbatim):
${filledSteps.join("\n")}

HANDLE OBJECTIONS:
${objections.length > 0 ? objections.join("\n") : "  No specific objections cataloged — handle naturally."}

SUCCESS CRITERIA: ${playbook.successCriteria || "Objective achieved, person satisfied."}
EXPECTED DURATION: ~${playbook.avgDurationSeconds || 120}s

IMPORTANT: Follow the playbook as a GUIDE, not a rigid script.
Adapt based on how the conversation flows. Skip steps that become irrelevant.
If the person gives info early, acknowledge it and move on.
=== END PLAYBOOK ===`;
}

// ─── Seed Playbooks ─────────────────────────────────────────────────────

export async function seedPlaybooks(): Promise<number> {
  const playbooks = [
    // 1. Restaurant Reservation (EN)
    {
      id: "pb_restaurant_en",
      name: "restaurant_reservation",
      category: "reservation",
      language: "en",
      openingLine: "Hi, I'd like to make a reservation please.",
      requiredInfo: [
        { name: "restaurant_name", label: "Restaurant name", example: "Olive Garden" },
        { name: "party_size", label: "Party size", example: "4" },
        { name: "date", label: "Date", example: "Saturday" },
        { name: "time", label: "Time", example: "8pm" },
        { name: "contact_name", label: "Reservation name", example: "José" },
      ],
      scriptSteps: [
        { step: 1, action: "Wait for greeting → Hi, I'd like to make a reservation for [party_size] people", waitFor: "acknowledgment" },
        { step: 2, action: "When they ask when → For [date] at [time]", waitFor: "availability check" },
        { step: 3, action: "When they ask name → Under the name [contact_name]", waitFor: "confirmation" },
        { step: 4, action: "If they ask for phone → Give the user's phone number" },
        { step: 5, action: "Confirm: So that's [party_size] at [time] on [date] under [contact_name]. Thank you!", waitFor: "final confirmation" },
      ],
      successCriteria: "Reservation confirmed with date, time, party size, and confirmation number if given.",
      commonObjections: [
        { trigger: "fully booked", response: "Do you have anything available around that time? I'm flexible with 30 minutes earlier or later." },
        { trigger: "don't take reservations", response: "Oh ok, what's the typical wait time for [party_size] on a [date] evening?" },
        { trigger: "robot", response: "I'm a digital assistant calling on behalf of [contact_name]. I can make the reservation if that works for you." },
        { trigger: "credit card", response: "I don't have a card to hold the reservation. Is there another way to confirm?" },
      ],
      avgDurationSeconds: 90,
    },
    // 2. Restaurant Reservation (PT-BR)
    {
      id: "pb_restaurant_pt",
      name: "restaurant_reservation",
      category: "reservation",
      language: "pt",
      openingLine: "Oi, boa tarde! Gostaria de fazer uma reserva por favor.",
      requiredInfo: [
        { name: "restaurant_name", label: "Nome do restaurante", example: "Olive Garden" },
        { name: "party_size", label: "Quantas pessoas", example: "4" },
        { name: "date", label: "Data", example: "sábado" },
        { name: "time", label: "Horário", example: "20h" },
        { name: "contact_name", label: "Nome da reserva", example: "José" },
      ],
      scriptSteps: [
        { step: 1, action: "Esperar cumprimento → Gostaria de reservar uma mesa pra [party_size] pessoas", waitFor: "confirmação" },
        { step: 2, action: "Quando perguntar quando → Pra [date] às [time]", waitFor: "disponibilidade" },
        { step: 3, action: "Quando perguntar nome → No nome de [contact_name]", waitFor: "confirmação" },
        { step: 4, action: "Se perguntar telefone → Dar o número do usuário" },
        { step: 5, action: "Confirmar: Então fica [party_size] pessoas, [date] às [time], nome [contact_name]. Obrigado!" },
      ],
      successCriteria: "Reserva confirmada com data, horário, quantidade e nome.",
      commonObjections: [
        { trigger: "lotado", response: "Tem algo perto desse horário? Posso ser flexível uns 30 minutos." },
        { trigger: "não aceitamos reserva", response: "Entendi, qual o tempo de espera pra [party_size] pessoas num [date]?" },
        { trigger: "robô", response: "Sou o assistente digital do [contact_name], ele me pediu pra ligar. Posso fazer a reserva?" },
      ],
      avgDurationSeconds: 90,
    },
    // 3. Appointment Booking (EN)
    {
      id: "pb_appointment_en",
      name: "appointment_booking",
      category: "reservation",
      language: "en",
      openingLine: "Hi, I'm calling to schedule an appointment.",
      requiredInfo: [
        { name: "business_name", label: "Business/Doctor name", example: "Dr. Smith" },
        { name: "service_type", label: "Service type", example: "cleaning" },
        { name: "preferred_date", label: "Preferred date", example: "next Tuesday" },
        { name: "preferred_time", label: "Preferred time", example: "morning" },
        { name: "patient_name", label: "Patient/Client name", example: "José" },
      ],
      scriptSteps: [
        { step: 1, action: "I'd like to schedule a [service_type] appointment", waitFor: "acknowledgment" },
        { step: 2, action: "Preferably on [preferred_date] around [preferred_time]", waitFor: "availability" },
        { step: 3, action: "The name is [patient_name]", waitFor: "confirmation" },
        { step: 4, action: "If they ask for phone or DOB → provide user's info" },
        { step: 5, action: "Confirm all details: date, time, service, name" },
      ],
      successCriteria: "Appointment confirmed with date, time, and any preparation instructions.",
      commonObjections: [
        { trigger: "next available", response: "Is there a waiting list or cancellation list I can be added to?" },
        { trigger: "are you the patient", response: "I'm calling on behalf of [patient_name]. They authorized me to schedule." },
        { trigger: "need insurance", response: "I'll need to check on that. Can I call back with the insurance info?" },
      ],
      avgDurationSeconds: 120,
    },
    // 4. Delivery Status (EN)
    {
      id: "pb_delivery_en",
      name: "delivery_status",
      category: "inquiry",
      language: "en",
      openingLine: "Hi, I'm calling to check the status of an order.",
      requiredInfo: [
        { name: "order_number", label: "Order/tracking number", example: "ORD-12345" },
        { name: "recipient_name", label: "Recipient name", example: "José" },
      ],
      scriptSteps: [
        { step: 1, action: "I'd like to check the status of order [order_number]", waitFor: "lookup" },
        { step: 2, action: "If they ask name → Under [recipient_name]", waitFor: "status" },
        { step: 3, action: "Note down: current status, estimated delivery date, any issues" },
        { step: 4, action: "If delayed → ask for new ETA and reason" },
      ],
      successCriteria: "Got delivery status, ETA, and any issues reported.",
      commonObjections: [
        { trigger: "can't find order", response: "Let me double check — the order number is [order_number]. Could it be under a different name?" },
        { trigger: "need to verify identity", response: "The order is for [recipient_name]. What information do you need to verify?" },
      ],
      avgDurationSeconds: 60,
    },
    // 5. Price Inquiry (EN)
    {
      id: "pb_price_en",
      name: "price_inquiry",
      category: "inquiry",
      language: "en",
      openingLine: "Hi, I'm calling to check pricing on something.",
      requiredInfo: [
        { name: "product_or_service", label: "Product or service name", example: "oil change" },
      ],
      scriptSteps: [
        { step: 1, action: "I'm interested in [product_or_service] — could you tell me the pricing?", waitFor: "price info" },
        { step: 2, action: "If multiple options → ask for details of each" },
        { step: 3, action: "Are there any current promotions or discounts?", waitFor: "promo info" },
        { step: 4, action: "Note all prices mentioned. Ask about scheduling if it's a service." },
      ],
      successCriteria: "Got pricing info, any promotions, and availability.",
      commonObjections: [
        { trigger: "need to see it", response: "I understand. Can you give me a ballpark range? My boss wants to compare a few options." },
        { trigger: "depends", response: "Sure, what factors affect the price? Can you give me a range for typical cases?" },
      ],
      avgDurationSeconds: 90,
    },
    // 6. Cancel/Modify Reservation (EN)
    {
      id: "pb_cancel_en",
      name: "cancel_reservation",
      category: "reservation",
      language: "en",
      openingLine: "Hi, I need to cancel a reservation.",
      requiredInfo: [
        { name: "reservation_name", label: "Reservation name", example: "José" },
        { name: "reservation_date", label: "Reservation date", example: "Saturday at 8pm" },
      ],
      scriptSteps: [
        { step: 1, action: "I need to cancel a reservation under [reservation_name] for [reservation_date]", waitFor: "lookup" },
        { step: 2, action: "If they ask for confirmation number → provide if available, otherwise identify by name+date" },
        { step: 3, action: "If they offer to reschedule → note the options and say 'Let me check with [reservation_name] and call back'" },
        { step: 4, action: "Confirm cancellation and ask if there's a cancellation fee" },
      ],
      successCriteria: "Reservation cancelled or rescheduling options obtained.",
      commonObjections: [
        { trigger: "cancellation fee", response: "I understand. How much is the fee? I'll let [reservation_name] know." },
        { trigger: "too late to cancel", response: "What are our options at this point? Can we modify instead of cancel?" },
      ],
      avgDurationSeconds: 60,
    },
  ];

  let inserted = 0;
  for (const pb of playbooks) {
    try {
      await prisma.$executeRaw`
        INSERT INTO call_playbooks (id, name, category, language, "openingLine", "requiredInfo", "scriptSteps", "successCriteria", "commonObjections", "avgDurationSeconds", "createdAt")
        VALUES (${pb.id}, ${pb.name}, ${pb.category}, ${pb.language}, ${pb.openingLine},
                ${JSON.stringify(pb.requiredInfo)}::jsonb, ${JSON.stringify(pb.scriptSteps)}::jsonb,
                ${pb.successCriteria}, ${JSON.stringify(pb.commonObjections)}::jsonb,
                ${pb.avgDurationSeconds}, now())
        ON CONFLICT (name, language) DO UPDATE SET
          "openingLine" = EXCLUDED."openingLine",
          "requiredInfo" = EXCLUDED."requiredInfo",
          "scriptSteps" = EXCLUDED."scriptSteps",
          "successCriteria" = EXCLUDED."successCriteria",
          "commonObjections" = EXCLUDED."commonObjections",
          "avgDurationSeconds" = EXCLUDED."avgDurationSeconds"
      `;
      inserted++;
    } catch (err) {
      console.error(`[PLAYBOOK] Failed to seed ${pb.name}/${pb.language}:`, (err as Error).message);
    }
  }

  console.log(`[PLAYBOOK] Seeded ${inserted} playbooks`);
  return inserted;
}
