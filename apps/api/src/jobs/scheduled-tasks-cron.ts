/**
 * Scheduled Tasks Cron — checks every minute for tasks due to run.
 *
 * For each due task:
 *   1. Execute the action (search, fetch data, etc.)
 *   2. Format and send result to user via their channel
 *   3. Update lastRun, nextRun, runCount
 *   4. Log in ScheduledTaskLog
 */

import cron from "node-cron";
import { prisma } from "@payjarvis/database";
import {
  executeTaskAction,
  deliverTaskResult,
  getNextRunFromCron,
} from "../services/scheduled-tasks.service.js";

// Check every minute for due tasks
cron.schedule("* * * * *", async () => {
  try {
    await runDueTasks();
  } catch (err) {
    console.error("[SCHEDULED-TASKS-CRON] Error:", (err as Error).message);
  }
});

async function runDueTasks() {
  const now = new Date();

  // Find all active tasks whose nextRun is <= now
  const dueTasks = await prisma.scheduledTask.findMany({
    where: {
      active: true,
      nextRun: { lte: now },
    },
    take: 20, // Process max 20 per minute to avoid overload
  });

  if (dueTasks.length === 0) return;

  console.log(`[SCHEDULED-TASKS-CRON] ${dueTasks.length} task(s) due`);

  for (const task of dueTasks) {
    const startTime = Date.now();
    let status = "success";
    let result = "";
    let error: string | undefined;

    try {
      // Check maxRuns limit
      if (task.maxRuns && task.runCount >= task.maxRuns) {
        await prisma.scheduledTask.update({
          where: { id: task.id },
          data: { active: false },
        });
        console.log(`[SCHEDULED-TASKS-CRON] Task ${task.id} reached maxRuns (${task.maxRuns}), deactivated`);
        continue;
      }

      // Execute the task action
      result = await executeTaskAction({
        action: task.action,
        actionData: task.actionData,
        userId: task.userId,
        language: task.language,
        channel: task.channel,
        channelId: task.channelId,
      });

      // Deliver result to user
      await deliverTaskResult({
        channel: task.channel,
        channelId: task.channelId,
        description: task.description,
        language: task.language,
      }, result);

    } catch (err) {
      status = "failed";
      error = (err as Error).message;
      console.error(`[SCHEDULED-TASKS-CRON] Task ${task.id} failed:`, error);
    }

    const duration = Date.now() - startTime;

    // Update task: lastRun, nextRun, runCount
    const nextRun = getNextRunFromCron(task.schedule, task.timezone);
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: {
        lastRun: now,
        nextRun,
        runCount: { increment: 1 },
      },
    });

    // Log execution
    await prisma.scheduledTaskLog.create({
      data: {
        taskId: task.id,
        status,
        result: result.substring(0, 4000),
        error: error || null,
        duration,
      },
    });
  }
}

console.log("[SCHEDULED-TASKS-CRON] Scheduled tasks cron job active (every minute)");
