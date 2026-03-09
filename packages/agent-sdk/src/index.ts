export { PayJarvis } from "./client.js";
export { checkHealth } from "./health.js";
export type { HealthResult } from "./health.js";
export type { PayJarvisConfig, ApprovalRequest, ApprovalDecision, SpendingLimits, HandoffRequest, HandoffResult } from "./types.js";

// Shared LLM prompt constants and tool schema
export { PAYJARVIS_SYSTEM_PROMPT, PAYJARVIS_TOOL_DESCRIPTION, PAYJARVIS_TOOL_SCHEMA, buildSystemPromptWithPayJarvis } from "./prompts.js";

// Platform integrations
export * as telegram from "./integrations/telegram/index.js";
export * as whatsapp from "./integrations/whatsapp/index.js";
