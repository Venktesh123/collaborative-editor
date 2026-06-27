// src/app/api/documents/[id]/route.ts
// GET    /api/documents/:id   — fetch document (with user's role)
// PATCH  /api/documents/:id   — update title or metadata
// DELETE /api/documents/:id   — soft-delete (owner only)

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { prisma, getDocumentForUser, writeAuditLog } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────
// GET /api/documents/:id
// ─────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const access = await getDocumentForUser(id, user.id);
  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { doc, role } = access;

  // Fetch collaborators for this document
  const collaborators = await prisma.collaborator.findMany({
    where: { documentId: id },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
  });

  return NextResponse.json({
    document: {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      revision: doc.revision,
      vectorClock: doc.vectorClock,
      ownerId: doc.ownerId,
      isPublic: doc.isPublic,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      userRole: role,
      collaborators: collaborators.map((c) => ({
        id: c.id,
        userId: c.userId,
        role: c.role,
        user: c.user,
      })),
    },
  });
}

// ─────────────────────────────────────────────
// PATCH /api/documents/:id
// ─────────────────────────────────────────────

const PatchDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  isPublic: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only OWNER or EDITOR can update metadata
  if (access.role === "VIEWER") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 422 }
    );
  }

  const updated = await prisma.document.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.isPublic !== undefined && { isPublic: parsed.data.isPublic }),
    },
  });

  return NextResponse.json({ document: updated });
}

// ─────────────────────────────────────────────
// DELETE /api/documents/:id
// ─────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only OWNER can delete
  if (access.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can delete" }, { status: 403 });
  }

  // Soft delete — preserves audit trail
  await prisma.document.update({
    where: { id },
    data: { isDeleted: true },
  });

  writeAuditLog({
    userId: user.id,
    documentId: id,
    action: "DOCUMENT_DELETED",
  });

  return NextResponse.json({ ok: true });
}
