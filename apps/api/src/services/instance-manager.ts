/**
 * OpenClaw Instance Manager
 *
 * Manages OpenClaw instances: slot allocation, user routing, and instance spawning.
 * Each instance runs as a PM2 process with its own directory and config.
 *
 * Directory layout:
 *   /root/openclaw/                    ← instance-01 (original)
 *   /root/openclaw-instances/instance-02/
 *   /root/openclaw-instances/instance-03/
 */

import { prisma } from "@payjarvis/database";
import { logEvent, AuditEvents } from "../core/audit-logger.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, cp, writeFile, rm } from "node:fs/promises";

const exec = promisify(execFile);

// ─── Constants ───────────────────────────────────────

const BASE_DIR = "/root/openclaw";
const INSTANCES_DIR = "/root/openclaw-instances";
const BASE_PORT = 3010; // instance-02 starts at 3010, instance-03 at 3011, etc.
const MAX_INSTANCES = 10;
const DEFAULT_CAPACITY = 100;
const SPAWN_THRESHOLD = 90; // spawn new instance when ALL >= 90%

// Files to copy from base OpenClaw install
const COPY_FILES = [
  "index.js",
  "gemini.js",
  "memory.js",
  "payjarvis.js",
  "package.json",
  "package-lock.json",
  "skills",
];

// ─── Slot Manager ────────────────────────────────────

/**
 * Find the best instance to assign a user to.
 * Strategy: pick the ACTIVE instance with the most available slots (least loaded).
 */
export async function findAvailableInstance(): Promise<{
  instanceId: string;
  name: string;
  port: number;
  currentLoad: number;
  capacity: number;
} | null> {
  const instance = await prisma.openClawInstance.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { currentLoad: "asc" },
  });

  if (!instance) return null;
  if (instance.currentLoad >= instance.capacity) return null;

  return {
    instanceId: instance.id,
    name: instance.name,
    port: instance.port,
    currentLoad: instance.currentLoad,
    capacity: instance.capacity,
  };
}

/**
 * Get all instances with their load status.
 */
export async function getInstanceStatus(): Promise<Array<{
  id: string;
  name: string;
  processName: string;
  port: number;
  capacity: number;
  currentLoad: number;
  available: number;
  status: string;
  utilizationPct: number;
}>> {
  const instances = await prisma.openClawInstance.findMany({
    orderBy: { name: "asc" },
  });

  return instances.map((inst) => ({
    id: inst.id,
    name: inst.name,
    processName: inst.processName,
    port: inst.port,
    capacity: inst.capacity,
    currentLoad: inst.currentLoad,
    available: Math.max(0, inst.capacity - inst.currentLoad),
    status: inst.status,
    utilizationPct: inst.capacity > 0
      ? Math.round((inst.currentLoad / inst.capacity) * 100)
      : 0,
  }));
}

/**
 * Check if an instance needs to be marked as FULL.
 */
export async function updateInstanceStatus(instanceId: string): Promise<void> {
  const instance = await prisma.openClawInstance.findUnique({
    where: { id: instanceId },
  });
  if (!instance) return;

  let newStatus = instance.status;
  if (instance.currentLoad >= instance.capacity && instance.status === "ACTIVE") {
    newStatus = "FULL";
  } else if (instance.currentLoad < instance.capacity && instance.status === "FULL") {
    newStatus = "ACTIVE";
  }

  if (newStatus !== instance.status) {
    await prisma.openClawInstance.update({
      where: { id: instanceId },
      data: { status: newStatus },
    });
  }
}

/**
 * Check if a specific instance is full.
 */
export async function isInstanceFull(instanceId: string): Promise<boolean> {
  const instance = await prisma.openClawInstance.findUnique({
    where: { id: instanceId },
  });
  if (!instance) return true;
  return instance.currentLoad >= instance.capacity;
}

// ─── User Router ─────────────────────────────────────

/**
 * Assign a user to an OpenClaw instance.
 * If user is already assigned, returns existing assignment.
 * If no instance available, triggers auto-spawn.
 */
export async function assignUserToInstance(userId: string): Promise<{
  success: boolean;
  instanceId?: string;
  instanceName?: string;
  port?: number;
  error?: string;
  spawned?: boolean;
}> {
  // Check existing assignment
  const existing = await prisma.instanceUser.findUnique({
    where: { userId },
    include: { instance: true },
  });

  if (existing) {
    if (existing.instance.status === "OFFLINE") {
      await removeUserFromInstance(userId);
    } else {
      return {
        success: true,
        instanceId: existing.instanceId,
        instanceName: existing.instance.name,
        port: existing.instance.port,
      };
    }
  }

  // Find available instance
  let available = await findAvailableInstance();
  let didSpawn = false;

  // No instance available — spawn one
  if (!available) {
    const spawned = await spawnInstance();
    if (!spawned.success) {
      return { success: false, error: spawned.error ?? "No available instances and cannot spawn new one" };
    }
    didSpawn = true;
    available = await findAvailableInstance();
    if (!available) {
      return { success: false, error: "Spawned instance but still no capacity" };
    }
  }

  // Assign user
  await prisma.$transaction([
    prisma.instanceUser.create({
      data: { userId, instanceId: available.instanceId },
    }),
    prisma.openClawInstance.update({
      where: { id: available.instanceId },
      data: { currentLoad: { increment: 1 } },
    }),
  ]);

  await updateInstanceStatus(available.instanceId);

  await logEvent({
    userId,
    event: AuditEvents.USER_ASSIGNED,
    layer: 1,
    payload: {
      instanceId: available.instanceId,
      instanceName: available.name,
      port: available.port,
    },
  }).catch(() => {});

  return {
    success: true,
    instanceId: available.instanceId,
    instanceName: available.name,
    port: available.port,
    spawned: didSpawn,
  };
}

/**
 * Remove a user from their assigned instance (release slot).
 */
export async function removeUserFromInstance(userId: string): Promise<boolean> {
  const assignment = await prisma.instanceUser.findUnique({
    where: { userId },
  });

  if (!assignment) return false;

  await prisma.$transaction([
    prisma.instanceUser.delete({ where: { userId } }),
    prisma.openClawInstance.update({
      where: { id: assignment.instanceId },
      data: { currentLoad: { decrement: 1 } },
    }),
  ]);

  await updateInstanceStatus(assignment.instanceId);

  return true;
}

/**
 * Get which instance a user is assigned to.
 */
export async function getUserInstance(userId: string): Promise<{
  instanceId: string;
  name: string;
  port: number;
  status: string;
} | null> {
  const assignment = await prisma.instanceUser.findUnique({
    where: { userId },
    include: { instance: true },
  });

  if (!assignment) return null;

  return {
    instanceId: assignment.instanceId,
    name: assignment.instance.name,
    port: assignment.instance.port,
    status: assignment.instance.status,
  };
}

// ─── User Router ─────────────────────────────────────

interface RouteResult {
  instanceId: string;
  name: string;
  endpoint: string; // "http://localhost:{port}" or base dir for polling instances
  port: number;
  status: string;
  spawned: boolean;
}

/**
 * Route a user to their OpenClaw instance endpoint.
 *  1. Check if user already has an instance → return it
 *  2. If not → assignUser (finds slot)
 *  3. If all full → auto-spawns new instance
 *  4. Returns full endpoint URL
 */
export async function routeUser(userId: string): Promise<{
  success: boolean;
  route?: RouteResult;
  error?: string;
}> {
  // 1. Existing assignment?
  const existing = await getUserInstance(userId);
  if (existing && existing.status !== "OFFLINE") {
    return {
      success: true,
      route: {
        instanceId: existing.instanceId,
        name: existing.name,
        endpoint: `http://localhost:${existing.port}`,
        port: existing.port,
        status: existing.status,
        spawned: false,
      },
    };
  }

  // 2 & 3. Assign (auto-spawns if needed)
  const result = await assignUserToInstance(userId);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    route: {
      instanceId: result.instanceId!,
      name: result.instanceName!,
      endpoint: `http://localhost:${result.port}`,
      port: result.port!,
      status: "ACTIVE",
      spawned: result.spawned ?? false,
    },
  };
}

/**
 * Get the OpenClaw endpoint for a specific bot.
 * Resolves: botId → bot.ownerId → instanceUser → instance → endpoint
 */
export async function getRouteForBot(botId: string): Promise<{
  success: boolean;
  endpoint?: string;
  instanceName?: string;
  port?: number;
  error?: string;
}> {
  // Resolve bot → owner
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { ownerId: true },
  });

  if (!bot) {
    return { success: false, error: "Bot not found" };
  }

  // Check owner's instance assignment
  const instance = await getUserInstance(bot.ownerId);

  if (!instance) {
    // Owner has no instance — assign one
    const routed = await routeUser(bot.ownerId);
    if (!routed.success) {
      return { success: false, error: routed.error };
    }
    return {
      success: true,
      endpoint: routed.route!.endpoint,
      instanceName: routed.route!.name,
      port: routed.route!.port,
    };
  }

  if (instance.status === "OFFLINE") {
    // Reassign to a live instance
    const routed = await routeUser(bot.ownerId);
    if (!routed.success) {
      return { success: false, error: routed.error };
    }
    return {
      success: true,
      endpoint: routed.route!.endpoint,
      instanceName: routed.route!.name,
      port: routed.route!.port,
    };
  }

  return {
    success: true,
    endpoint: `http://localhost:${instance.port}`,
    instanceName: instance.name,
    port: instance.port,
  };
}

// ─── Instance Spawner ────────────────────────────────

/**
 * Get the next available port for a new instance.
 * instance-01 (original) uses polling (no HTTP port).
 * instance-02+ get sequential ports starting at BASE_PORT.
 */
async function getNextPort(): Promise<number> {
  const instances = await prisma.openClawInstance.findMany({
    where: { port: { gte: BASE_PORT } },
    orderBy: { port: "desc" },
    take: 1,
  });
  return instances.length > 0 ? instances[0].port + 1 : BASE_PORT;
}

/**
 * Get the next instance number.
 */
async function getNextNumber(): Promise<number> {
  const count = await prisma.openClawInstance.count();
  return count + 1;
}

/**
 * Spawn a new OpenClaw instance:
 *  1. Create /root/openclaw-instances/instance-{N}/
 *  2. Copy config base from /root/openclaw/
 *  3. Generate .env with unique TELEGRAM_TOKEN placeholder and port
 *  4. npm install
 *  5. pm2 start
 *  6. Save to database
 */
export async function spawnInstance(options?: {
  capacity?: number;
}): Promise<{
  success: boolean;
  instanceId?: string;
  name?: string;
  port?: number;
  processName?: string;
  dir?: string;
  error?: string;
}> {
  const totalInstances = await prisma.openClawInstance.count({
    where: { status: { not: "OFFLINE" } },
  });

  if (totalInstances >= MAX_INSTANCES) {
    return {
      success: false,
      error: `Maximum active instances reached (${MAX_INSTANCES}).`,
    };
  }

  const num = await getNextNumber();
  const port = await getNextPort();
  const name = `instance-${String(num).padStart(2, "0")}`;
  const processName = `openclaw-${name}`;
  const capacity = options?.capacity ?? DEFAULT_CAPACITY;
  const instanceDir = `${INSTANCES_DIR}/${name}`;

  try {
    // 1. Create instances directory if needed
    if (!existsSync(INSTANCES_DIR)) {
      await mkdir(INSTANCES_DIR, { recursive: true });
    }

    // 2. Create instance directory
    await mkdir(instanceDir, { recursive: true });

    // 3. Copy files from base OpenClaw
    for (const file of COPY_FILES) {
      const src = `${BASE_DIR}/${file}`;
      if (existsSync(src)) {
        await cp(src, `${instanceDir}/${file}`, { recursive: true });
      }
    }

    // 4. Generate .env for this instance
    //    Uses same DB, PayJarvis API, but needs unique TELEGRAM_TOKEN per instance
    const envContent = [
      `# OpenClaw ${name} — auto-generated`,
      `INSTANCE_NAME=${name}`,
      `INSTANCE_PORT=${port}`,
      ``,
      `# IMPORTANT: Set a unique Telegram bot token for this instance`,
      `# Each instance needs its own bot via @BotFather`,
      `TELEGRAM_TOKEN=PLACEHOLDER_SET_TOKEN_FOR_${name.toUpperCase().replace("-", "_")}`,
      ``,
      `GEMINI_API_KEY=${process.env.GEMINI_API_KEY || ""}`,
      `DATABASE_URL=${process.env.DATABASE_URL || ""}`,
      `PAYJARVIS_API_KEY=${process.env.PAYJARVIS_API_KEY || ""}`,
      `PAYJARVIS_BOT_ID=${process.env.PAYJARVIS_BOT_ID || ""}`,
      `PAYJARVIS_URL=${process.env.PAYJARVIS_URL || "https://www.payjarvis.com"}`,
      `ADMIN_TELEGRAM_ID=${process.env.ADMIN_TELEGRAM_ID || ""}`,
    ].join("\n");

    await writeFile(`${instanceDir}/.env`, envContent);

    // 5. Generate ecosystem.config.js for PM2
    const ecosystemContent = `module.exports = {
  apps: [{
    name: '${processName}',
    script: 'index.js',
    cwd: '${instanceDir}',
    restart_delay: 3000,
    max_restarts: 10
  }]
};
`;
    await writeFile(`${instanceDir}/ecosystem.config.js`, ecosystemContent);

    // 6. Install dependencies
    console.log(`[InstanceManager] Installing deps for ${name}...`);
    await exec("npm", ["install", "--production"], {
      cwd: instanceDir,
      timeout: 60000,
    });

    // 7. Start via PM2
    console.log(`[InstanceManager] Starting PM2 process ${processName}...`);
    await exec("pm2", ["start", "ecosystem.config.js"], {
      cwd: instanceDir,
      timeout: 15000,
    });

    // 8. Save PM2 state
    await exec("pm2", ["save"], { timeout: 10000 }).catch(() => {});

    // 9. Register in database
    const instance = await prisma.openClawInstance.create({
      data: {
        name,
        processName,
        port,
        capacity,
        currentLoad: 0,
        status: "ACTIVE",
      },
    });

    console.log(`[InstanceManager] Spawned ${name} → dir=${instanceDir}, PM2=${processName}, port=${port}, capacity=${capacity}`);

    await logEvent({
      event: AuditEvents.INSTANCE_SPAWNED,
      layer: 1,
      payload: {
        instanceId: instance.id,
        name,
        port,
        processName,
        dir: instanceDir,
        capacity,
      },
    }).catch(() => {});

    return {
      success: true,
      instanceId: instance.id,
      name,
      port,
      processName,
      dir: instanceDir,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown spawn error";
    console.error(`[InstanceManager] Spawn failed for ${name}:`, msg);

    // Cleanup on failure
    if (existsSync(instanceDir)) {
      await rm(instanceDir, { recursive: true, force: true }).catch(() => {});
    }
    await exec("pm2", ["delete", processName]).catch(() => {});

    return { success: false, error: msg };
  }
}

/**
 * Despawn an instance: stop PM2, remove directory, delete from DB.
 * Only allowed if instance is empty (currentLoad === 0) AND more than 1 active instance exists.
 */
export async function despawnInstance(instanceId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const instance = await prisma.openClawInstance.findUnique({
    where: { id: instanceId },
    include: { users: true },
  });

  if (!instance) {
    return { success: false, error: "Instance not found" };
  }

  // Never despawn instance-01 (the original)
  if (instance.name === "instance-01") {
    return { success: false, error: "Cannot despawn the primary instance (instance-01)" };
  }

  // Must be empty
  if (instance.users.length > 0 || instance.currentLoad > 0) {
    return {
      success: false,
      error: `Instance has ${instance.users.length} users assigned. Reassign them first.`,
    };
  }

  // Must have >1 active instance remaining
  const activeCount = await prisma.openClawInstance.count({
    where: { status: { in: ["ACTIVE", "FULL"] }, id: { not: instanceId } },
  });
  if (activeCount < 1) {
    return { success: false, error: "Cannot despawn — would leave zero active instances" };
  }

  try {
    // 1. Stop PM2 process
    console.log(`[InstanceManager] Stopping PM2 process ${instance.processName}...`);
    await exec("pm2", ["delete", instance.processName]).catch(() => {});
    await exec("pm2", ["save"]).catch(() => {});

    // 2. Remove directory
    const instanceDir = `${INSTANCES_DIR}/${instance.name}`;
    if (existsSync(instanceDir)) {
      console.log(`[InstanceManager] Removing directory ${instanceDir}...`);
      await rm(instanceDir, { recursive: true, force: true });
    }

    // 3. Delete from database
    await prisma.openClawInstance.delete({ where: { id: instanceId } });

    console.log(`[InstanceManager] Despawned ${instance.name}`);

    await logEvent({
      event: AuditEvents.INSTANCE_SPAWNED, // reuse event type
      layer: 1,
      payload: {
        action: "instance_despawned",
        instanceId,
        name: instance.name,
        processName: instance.processName,
      },
    }).catch(() => {});

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown despawn error";
    console.error(`[InstanceManager] Despawn failed for ${instance.name}:`, msg);
    return { success: false, error: msg };
  }
}

/**
 * Mark an instance as OFFLINE (graceful shutdown without removing).
 * Users will be reassigned on next request.
 */
export async function deactivateInstance(instanceId: string): Promise<boolean> {
  const instance = await prisma.openClawInstance.findUnique({
    where: { id: instanceId },
  });
  if (!instance) return false;

  // Stop PM2 process
  await exec("pm2", ["stop", instance.processName]).catch(() => {});

  await prisma.openClawInstance.update({
    where: { id: instanceId },
    data: { status: "OFFLINE" },
  });

  console.log(`[InstanceManager] Deactivated ${instance.name}`);
  return true;
}

// ─── Auto-scaling ────────────────────────────────────

/**
 * Check if ALL instances are >= 90% capacity. If so, spawn a new one.
 * Call this periodically or on user registration.
 */
export async function checkAndSpawn(): Promise<{
  totalCapacity: number;
  totalLoad: number;
  utilizationPct: number;
  allAboveThreshold: boolean;
  spawned: boolean;
  spawnedInstance?: string;
}> {
  const instances = await prisma.openClawInstance.findMany({
    where: { status: { in: ["ACTIVE", "FULL"] } },
  });

  if (instances.length === 0) {
    return {
      totalCapacity: 0,
      totalLoad: 0,
      utilizationPct: 0,
      allAboveThreshold: false,
      spawned: false,
    };
  }

  const totalCapacity = instances.reduce((sum, i) => sum + i.capacity, 0);
  const totalLoad = instances.reduce((sum, i) => sum + i.currentLoad, 0);
  const utilizationPct = totalCapacity > 0
    ? Math.round((totalLoad / totalCapacity) * 100)
    : 0;

  // Check if ALL instances are >= 90%
  const allAboveThreshold = instances.every(
    (i) => i.capacity > 0 && (i.currentLoad / i.capacity) * 100 >= SPAWN_THRESHOLD
  );

  let spawned = false;
  let spawnedInstance: string | undefined;

  if (allAboveThreshold) {
    console.log(
      `[InstanceManager] All ${instances.length} instances >= ${SPAWN_THRESHOLD}% — spawning new instance`
    );
    const result = await spawnInstance();
    spawned = result.success;
    spawnedInstance = result.name;
  }

  return { totalCapacity, totalLoad, utilizationPct, allAboveThreshold, spawned, spawnedInstance };
}

// ─── Convenience Aliases ─────────────────────────────

export const assignUser = assignUserToInstance;
export const releaseUser = removeUserFromInstance;
export const getInstanceForUser = getUserInstance;
export const getInstanceStats = getInstanceStatus;
