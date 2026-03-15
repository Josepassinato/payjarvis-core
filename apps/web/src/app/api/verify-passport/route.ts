import { NextResponse } from "next/server";
import { createHmac } from "crypto";

export async function POST(request: Request) {
  const botSecret = process.env.PAYJARVIS_BOT_SECRET;

  if (!botSecret) {
    return NextResponse.json(
      { error: "Server misconfigured: missing bot secret" },
      { status: 500 }
    );
  }

  const visaTapToken = request.headers.get("Visa-TAP-Token");
  const mcAgentToken = request.headers.get("MC-Agent-Token");
  const signature = request.headers.get("X-Signature");

  if (!visaTapToken && !mcAgentToken) {
    return NextResponse.json(
      {
        error: "Forbidden: no valid agent credential provided",
        required_headers: ["Visa-TAP-Token", "MC-Agent-Token"],
        docs: "https://payjarvis.com/.well-known/agent-info.json",
      },
      { status: 403 }
    );
  }

  // Validate HMAC signature
  const token = visaTapToken || mcAgentToken || "";
  const expectedSignature = createHmac("sha256", botSecret)
    .update(token)
    .digest("hex");

  if (!signature || signature !== expectedSignature) {
    return NextResponse.json(
      {
        error: "Forbidden: HMAC signature mismatch",
        hint: "Sign the token with PAYJARVIS_BOT_SECRET using HMAC-SHA256",
      },
      { status: 403 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // empty body is acceptable
  }

  const protocol = visaTapToken ? "visa-tap" : "mc-agentpay";

  return NextResponse.json({
    status: "approved",
    agent_id: "payjarvis-bot-v1",
    protocol,
    cart_total: body.cart_total ?? null,
    timestamp: new Date().toISOString(),
    approval_id: `pj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}
