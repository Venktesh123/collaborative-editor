// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function getDocumentForUser(documentId: string, userId: string) {
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      isDeleted: false,
      OR: [
        { ownerId: userId },
        { collaborators: { some: { userId } } },
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
      : (doc.collaborators[0]?.role as "EDITOR" | "VIEWER" | undefined) ?? null;

  return { doc, role };
}

export async function writeAuditLog(data: {
  userId?: string;
  documentId?: string;
  action: Parameters<typeof prisma.auditLog.create>[0]["data"]["action"];
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) {
  prisma.auditLog
    .create({
      data: {
        userId: data.userId,
        documentId: data.documentId,
        action: data.action,
        metadata: (data.metadata ?? {}) as object,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    })
    .catch(console.error);
}