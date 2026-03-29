/**
 * Engagement Cron Jobs — schedules all proactive messaging.
 *
 * Cron schedule (all times UTC):
 *   12:00 daily  → Morning briefing (8AM EST)
 *   18:00 daily  → Reengagement check (2PM EST)
 *   14:00 Sunday → Weekly report (10AM EST)
 *   15:00 Tue/Thu → Smart tips (11AM EST)
 *   12:00 daily  → Birthday check
 */

import cron from "node-cron";
import {
  runMorningBriefings,
  runReengagement,
  runWeeklyReports,
  runSmartTips,
  runBirthdayCheck,
} from "../services/engagement/proactive-messages.service.js";

// Morning briefing: 8AM EST = 12:00 UTC
cron.schedule("0 12 * * *", async () => {
  try {
    await runMorningBriefings();
  } catch (err) {
    console.error("[ENGAGEMENT-CRON] Morning briefings error:", err);
  }
});

// Reengagement check: 2PM EST = 18:00 UTC
cron.schedule("0 18 * * *", async () => {
  try {
    await runReengagement();
  } catch (err) {
    console.error("[ENGAGEMENT-CRON] Reengagement error:", err);
  }
});

// Weekly report: Sunday 10AM EST = 14:00 UTC Sunday
cron.schedule("0 14 * * 0", async () => {
  try {
    await runWeeklyReports();
  } catch (err) {
    console.error("[ENGAGEMENT-CRON] Weekly reports error:", err);
  }
});

// Smart tips: Tuesday & Thursday 11AM EST = 15:00 UTC
cron.schedule("0 15 * * 2,4", async () => {
  try {
    await runSmartTips();
  } catch (err) {
    console.error("[ENGAGEMENT-CRON] Smart tips error:", err);
  }
});

// Birthday check: daily at 12:00 UTC (alongside morning briefing)
cron.schedule("5 12 * * *", async () => {
  try {
    await runBirthdayCheck();
  } catch (err) {
    console.error("[ENGAGEMENT-CRON] Birthday check error:", err);
  }
});

console.log("[ENGAGEMENT-CRON] All engagement cron jobs scheduled");
