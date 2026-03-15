import cron from "node-cron";
import { processTrialAlerts } from "../services/credit.service.js";

cron.schedule("0 9 * * *", async () => {
  console.log("[Trial Cron] Checking trial alerts");
  try { await processTrialAlerts(); }
  catch (err) { console.error("[Trial Cron]", (err as Error).message); }
});

console.log("[Cron] Trial alerts: daily 9 AM");
