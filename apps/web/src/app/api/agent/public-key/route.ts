import { NextResponse } from "next/server";

export async function GET() {
  const publicKey =
    process.env.PAYJARVIS_AGENT_PUBLIC_KEY ||
    "placeholder-replace-with-ecdsa-p256";

  return NextResponse.json({
    agent_id: "payjarvis-bot-v1",
    public_key: publicKey,
    algorithm: "ECDSA-P256",
    protocols: ["visa-tap", "mc-agentpay", "web-bot-auth", "mcp"],
    key_format: "PEM",
    created_at: "2026-03-13T00:00:00Z",
    docs: "https://payjarvis.com/.well-known/agent-info.json",
  });
}
