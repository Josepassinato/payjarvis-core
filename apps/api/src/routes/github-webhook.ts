/**
 * GitHub Webhook — Receives CI failure notifications and triggers auto-fix
 *
 * Setup in GitHub:
 * - Repo → Settings → Webhooks → Add webhook
 * - URL: https://www.payjarvis.com/webhooks/github
 * - Content-Type: application/json
 * - Secret: value of GITHUB_WEBHOOK_SECRET env var
 * - Events: Workflow runs
 */

import { FastifyInstance } from "fastify";
import { createHmac } from "crypto";
import { exec } from "child_process";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const PROJECT_DIR = "/root/Payjarvis";

function verifySignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false;
  const expected = "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  return expected === signature;
}

export async function githubWebhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/github", {
    config: { rawBody: true },
  }, async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"] as string;
    const event = request.headers["x-github-event"] as string;
    const rawBody = JSON.stringify(request.body);

    // Verify webhook signature
    if (!WEBHOOK_SECRET) {
      request.log.warn("[GITHUB-WEBHOOK] GITHUB_WEBHOOK_SECRET not configured");
      return reply.code(500).send({ error: "Webhook secret not configured" });
    }

    if (!verifySignature(rawBody, signature || "")) {
      request.log.warn("[GITHUB-WEBHOOK] Invalid signature");
      return reply.code(403).send({ error: "Invalid signature" });
    }

    // Only handle workflow_run events
    if (event !== "workflow_run") {
      return reply.code(200).send({ status: "ignored", event });
    }

    const body = request.body as {
      action: string;
      workflow_run: {
        conclusion: string;
        head_branch: string;
        head_sha: string;
        name: string;
        html_url: string;
      };
    };

    const { action, workflow_run } = body;

    // Only trigger on completed + failure
    if (action !== "completed" || workflow_run.conclusion !== "failure") {
      return reply.code(200).send({
        status: "ignored",
        reason: `action=${action}, conclusion=${workflow_run.conclusion}`,
      });
    }

    const branch = workflow_run.head_branch;
    const sha = workflow_run.head_sha;

    request.log.info(`[GITHUB-WEBHOOK] CI failed on ${branch} (${sha.substring(0, 7)}). Triggering auto-fix.`);

    // Run auto-fix script in background (non-blocking)
    exec(
      `bash ${PROJECT_DIR}/scripts/ci-auto-fix.sh "${branch}" >> /tmp/ci-autofix-webhook.log 2>&1 &`,
      (error) => {
        if (error) {
          console.error("[GITHUB-WEBHOOK] Failed to launch auto-fix:", error.message);
        }
      }
    );

    return reply.code(200).send({
      status: "auto-fix-triggered",
      branch,
      commit: sha.substring(0, 7),
    });
  });
}
