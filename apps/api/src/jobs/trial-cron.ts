import cron from "node-cron";
import { processTrialAlerts } from "../services/credit.service.js";
import { processWhatsAppTrialAlerts } from "../services/trial.service.js";

cron.schedule("0 9 * * *", async () => {
  console.log("[Trial Cron] Checking trial alerts");
  try { await processTrialAlerts(); }
  catch (err) { console.error("[Trial Cron] credits:", (err as Error).message); }

  try { await processWhatsAppTrialAlerts(); }
  catch (err) { console.error("[Trial Cron] whatsapp:", (err as Error).message); }
});

console.log("[Cron] Trial alerts: daily 9 AM (credits + whatsapp)");
