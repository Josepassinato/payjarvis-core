/**
 * Email Service — Resend API
 *
 * Sends transactional emails from jarvis@payjarvis.com via Resend.
 * Fallback: logs warning if RESEND_API_KEY not configured.
 */

import { Resend } from "resend";

// ─── Singleton Client ─────────────────────────────────

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY not configured");
    _resend = new Resend(apiKey);
  }
  return _resend;
}

const EMAIL_FROM = process.env.EMAIL_FROM || "PayJarvis <jarvis@payjarvis.com>";

/**
 * Check if email service is configured.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

// ─── Send Email ──────────────────────────────────────

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailConfigured()) {
    console.warn("[Email] RESEND_API_KEY not configured — skipping send");
    return { success: false, error: "Email not configured" };
  }

  try {
    const resend = getResend();

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    if (error) {
      console.error(`[Email] Resend error to ${options.to}:`, error.message);
      return { success: false, error: error.message };
    }

    console.log(`[Email] Sent to ${options.to}: ${data?.id}`);
    return { success: true, messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown email error";
    console.error("[Email] Send failed:", msg);
    return { success: false, error: msg };
  }
}

// ─── Email Templates ─────────────────────────────────

const BRAND_COLOR = "#6366f1"; // Indigo-500
const FOOTER = `
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">
    <p>PayJarvis — Autonomous Payment Intelligence</p>
    <p>This is an automated message. Do not reply directly.</p>
  </div>
`;

function wrap(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:${BRAND_COLOR};padding:20px 24px;">
      <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">${title}</h1>
    </div>
    <div style="padding:24px;">
      ${body}
      ${FOOTER}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Approval request email — sent when a transaction needs human approval.
 */
export function templateApprovalRequest(data: {
  botName: string;
  merchantName: string;
  amount: number;
  currency: string;
  category: string;
  approvalId: string;
  expiresAt: string;
  dashboardUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `[PayJarvis] Approval needed — $${data.amount.toFixed(2)} at ${data.merchantName}`;

  const html = wrap("Approval Required", `
    <p style="color:#374151;font-size:15px;">
      <strong>${data.botName}</strong> is requesting authorization for a payment:
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#6b7280;width:120px;">Merchant</td><td style="padding:8px 0;color:#111827;font-weight:600;">${data.merchantName}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Amount</td><td style="padding:8px 0;color:#111827;font-weight:600;">$${data.amount.toFixed(2)} ${data.currency}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Category</td><td style="padding:8px 0;color:#111827;">${data.category}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Expires</td><td style="padding:8px 0;color:#ef4444;">${data.expiresAt}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${data.dashboardUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">
        Review in Dashboard
      </a>
    </div>
    <p style="color:#9ca3af;font-size:13px;text-align:center;">
      Or respond via Telegram for instant approval.
    </p>
  `);

  const text = `PayJarvis — Approval Required\n\n${data.botName} requests $${data.amount.toFixed(2)} ${data.currency} at ${data.merchantName} (${data.category}).\nExpires: ${data.expiresAt}\n\nReview: ${data.dashboardUrl}`;

  return { subject, html, text };
}

/**
 * Transaction confirmed email — sent after a payment is approved and processed.
 */
export function templateTransactionConfirmed(data: {
  botName: string;
  merchantName: string;
  amount: number;
  currency: string;
  transactionId: string;
  timestamp: string;
}): { subject: string; html: string; text: string } {
  const subject = `[PayJarvis] Payment confirmed — $${data.amount.toFixed(2)} at ${data.merchantName}`;

  const html = wrap("Payment Confirmed", `
    <p style="color:#374151;font-size:15px;">A payment has been successfully processed:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#6b7280;width:120px;">Status</td><td style="padding:8px 0;color:#059669;font-weight:600;">✓ Approved</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Merchant</td><td style="padding:8px 0;color:#111827;font-weight:600;">${data.merchantName}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Amount</td><td style="padding:8px 0;color:#111827;font-weight:600;">$${data.amount.toFixed(2)} ${data.currency}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Bot</td><td style="padding:8px 0;color:#111827;">${data.botName}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Transaction</td><td style="padding:8px 0;color:#6b7280;font-family:monospace;font-size:12px;">${data.transactionId}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Time</td><td style="padding:8px 0;color:#111827;">${data.timestamp}</td></tr>
    </table>
  `);

  const text = `PayJarvis — Payment Confirmed\n\n$${data.amount.toFixed(2)} ${data.currency} at ${data.merchantName}\nBot: ${data.botName}\nTx: ${data.transactionId}\nTime: ${data.timestamp}`;

  return { subject, html, text };
}

/**
 * Transaction blocked email — sent when a payment is denied by policy.
 */
export function templateTransactionBlocked(data: {
  botName: string;
  merchantName: string;
  amount: number;
  currency: string;
  reason: string;
  dashboardUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `[PayJarvis] Payment blocked — $${data.amount.toFixed(2)} at ${data.merchantName}`;

  const html = wrap("Payment Blocked", `
    <p style="color:#374151;font-size:15px;">A payment attempt was blocked by your policy rules:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#6b7280;width:120px;">Status</td><td style="padding:8px 0;color:#ef4444;font-weight:600;">✗ Blocked</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Merchant</td><td style="padding:8px 0;color:#111827;font-weight:600;">${data.merchantName}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Amount</td><td style="padding:8px 0;color:#111827;font-weight:600;">$${data.amount.toFixed(2)} ${data.currency}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Bot</td><td style="padding:8px 0;color:#111827;">${data.botName}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Reason</td><td style="padding:8px 0;color:#ef4444;">${data.reason}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${data.dashboardUrl}" style="display:inline-block;background:#374151;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">
        Review Policy Rules
      </a>
    </div>
  `);

  const text = `PayJarvis — Payment Blocked\n\n$${data.amount.toFixed(2)} ${data.currency} at ${data.merchantName}\nBot: ${data.botName}\nReason: ${data.reason}\n\nReview rules: ${data.dashboardUrl}`;

  return { subject, html, text };
}

/**
 * Daily summary email.
 */
export function templateDailySummary(data: {
  date: string;
  totalTransactions: number;
  totalApproved: number;
  totalBlocked: number;
  totalPending: number;
  totalSpent: number;
  currency: string;
  topMerchants: Array<{ name: string; amount: number; count: number }>;
  dashboardUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `[PayJarvis] Daily Summary — ${data.date}`;

  const merchantRows = data.topMerchants
    .map(m => `<tr><td style="padding:4px 8px;color:#111827;">${m.name}</td><td style="padding:4px 8px;color:#111827;text-align:right;">$${m.amount.toFixed(2)}</td><td style="padding:4px 8px;color:#6b7280;text-align:right;">${m.count}x</td></tr>`)
    .join("");

  const html = wrap(`Daily Summary — ${data.date}`, `
    <div style="display:flex;gap:12px;margin:16px 0;flex-wrap:wrap;">
      <div style="flex:1;min-width:100px;background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;">
        <div style="color:#059669;font-size:24px;font-weight:700;">${data.totalApproved}</div>
        <div style="color:#6b7280;font-size:12px;">Approved</div>
      </div>
      <div style="flex:1;min-width:100px;background:#fef2f2;border-radius:8px;padding:12px;text-align:center;">
        <div style="color:#ef4444;font-size:24px;font-weight:700;">${data.totalBlocked}</div>
        <div style="color:#6b7280;font-size:12px;">Blocked</div>
      </div>
      <div style="flex:1;min-width:100px;background:#eff6ff;border-radius:8px;padding:12px;text-align:center;">
        <div style="color:#3b82f6;font-size:24px;font-weight:700;">$${data.totalSpent.toFixed(2)}</div>
        <div style="color:#6b7280;font-size:12px;">Total Spent</div>
      </div>
    </div>
    ${data.topMerchants.length > 0 ? `
    <h3 style="color:#374151;font-size:14px;margin:20px 0 8px;">Top Merchants</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid #e5e7eb;">
        <th style="padding:4px 8px;text-align:left;color:#6b7280;font-size:12px;">Merchant</th>
        <th style="padding:4px 8px;text-align:right;color:#6b7280;font-size:12px;">Amount</th>
        <th style="padding:4px 8px;text-align:right;color:#6b7280;font-size:12px;">Txns</th>
      </tr></thead>
      <tbody>${merchantRows}</tbody>
    </table>` : ""}
    <div style="text-align:center;margin:24px 0;">
      <a href="${data.dashboardUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">
        View Dashboard
      </a>
    </div>
  `);

  const text = `PayJarvis Daily Summary — ${data.date}\n\nApproved: ${data.totalApproved} | Blocked: ${data.totalBlocked} | Spent: $${data.totalSpent.toFixed(2)} ${data.currency}\n\nDashboard: ${data.dashboardUrl}`;

  return { subject, html, text };
}

/**
 * Handoff request email — when a browser session needs human intervention.
 */
export function templateHandoffRequest(data: {
  botName: string;
  obstacleType: string;
  description: string;
  sessionUrl: string;
}): { subject: string; html: string; text: string } {
  const obstacleLabels: Record<string, string> = {
    CAPTCHA: "CAPTCHA / Security Challenge",
    AUTH: "Login / Authentication Required",
    NAVIGATION: "Navigation Error",
    OTHER: "Manual Intervention Needed",
  };

  const subject = `[PayJarvis] Human help needed — ${obstacleLabels[data.obstacleType] ?? data.obstacleType}`;

  const html = wrap("Human Handoff Required", `
    <p style="color:#374151;font-size:15px;">
      <strong>${data.botName}</strong> encountered an obstacle and needs your help:
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#6b7280;width:120px;">Obstacle</td><td style="padding:8px 0;color:#f59e0b;font-weight:600;">${obstacleLabels[data.obstacleType] ?? data.obstacleType}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">Details</td><td style="padding:8px 0;color:#111827;">${data.description}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${data.sessionUrl}" style="display:inline-block;background:#f59e0b;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">
        Open Live Session
      </a>
    </div>
    <p style="color:#9ca3af;font-size:13px;text-align:center;">
      The browser session is kept alive for you. Click above to take over.
    </p>
  `);

  const text = `PayJarvis — Human Handoff Required\n\nBot: ${data.botName}\nObstacle: ${obstacleLabels[data.obstacleType] ?? data.obstacleType}\nDetails: ${data.description}\n\nOpen session: ${data.sessionUrl}`;

  return { subject, html, text };
}

/**
 * Onboarding confirmation email — 6-digit code sent during bot onboarding.
 */
export function templateOnboardingConfirm(data: {
  code: string;
}): { subject: string; html: string; text: string } {
  const subject = `Seu código de confirmação PayJarvis: ${data.code}`;

  const html = wrap("Confirme seu email", `
    <p style="color:#374151;font-size:15px;">Seu código de confirmação:</p>
    <div style="text-align:center;margin:24px 0;">
      <span style="display:inline-block;background:#f3f4f6;border:2px solid ${BRAND_COLOR};border-radius:12px;padding:16px 32px;font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">${data.code}</span>
    </div>
    <p style="color:#6b7280;font-size:14px;text-align:center;">
      Volta ao Telegram e digita este código para continuar.<br/>
      O código expira em 10 minutos.
    </p>
  `);

  const text = `PayJarvis — Código de Confirmação\n\nSeu código: ${data.code}\n\nVolte ao Telegram e digite este código.\nExpira em 10 minutos.`;

  return { subject, html, text };
}

/**
 * Send onboarding confirmation email.
 */
export async function sendOnboardingConfirmation(email: string, code: string): Promise<{ success: boolean; error?: string }> {
  const template = templateOnboardingConfirm({ code });
  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}
