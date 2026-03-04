import { prisma } from "@payjarvis/database";

interface AuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  actorType: string;
  actorId: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
}

export async function createAuditLog(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorType: entry.actorType,
      actorId: entry.actorId,
      payload: entry.payload ? JSON.parse(JSON.stringify(entry.payload)) : undefined,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
