import cron from "node-cron";
import { processPendingSequences } from "../services/sequence.service.js";

cron.schedule("0 * * * *", async () => {
  try { await processPendingSequences(); }
  catch (err) { console.error("[Sequence Cron]", (err as Error).message); }
});

cron.schedule("0 9 * * *", async () => {
  try { await processPendingSequences(); }
  catch (err) { console.error("[Sequence Cron 9AM]", (err as Error).message); }
});

console.log("[Cron] Sequence: hourly + 9 AM");
