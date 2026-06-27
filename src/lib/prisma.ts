// src/lib/prisma.ts
// Singleton Prisma client — prevents connection pool exhaustion during hot reload

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ─────────────────────────────────────────────
// HELPER: scoped query to enforce tenant isolation
// Always filters by userId — never trust the documentId alone
// ─────────────────────────────────────────────

/**
 * Returns a document only if the requesting user is an owner or collaborator.
 * This is the RLS equivalent at the ORM layer.
 */
export async function getDocumentForUser(
  documentId: string,
  userId: string
) {
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      isDeleted: false,
      OR: [
        { ownerId: userId },
        {
          collaborators: {
            some: { userId },
          },
        },
      ],
    },
    include: {
      collaborators: {
        where: { userId },
        select: { role: true },
      },
    },
  });

  if (!doc) return null;

  const role =
    doc.ownerId === userId
      ? ("OWNER" as const)
      : (doc.collaborators[0]?.role ?? null);

  return { doc, role };
}

/**
 * Audit log helper — fire-and-forget (non-blocking)
 */
export async function writeAuditLog(data: {
  userId?: string;
  documentId?: string;
  action: Parameters<typeof prisma.auditLog.create>[0]["data"]["action"];
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) {
  // Non-critical, swallow errors
  prisma.auditLog
    .create({
      data: {
        userId: data.userId,
        documentId: data.documentId,
        action: data.action,
        metadata: data.metadata ?? {},
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    })
    .catch(console.error);
}
