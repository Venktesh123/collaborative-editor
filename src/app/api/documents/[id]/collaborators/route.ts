// src/app/api/documents/[id]/collaborators/route.ts
// GET    /api/documents/:id/collaborators      — list collaborators
// POST   /api/documents/:id/collaborators      — add collaborator by email
// PATCH  /api/documents/:id/collaborators      — update collaborator role
// DELETE /api/documents/:id/collaborators      — remove collaborator

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { prisma, getDocumentForUser, writeAuditLog } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────
// GET — list collaborators
// ─────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const collaborators = await prisma.collaborator.findMany({
    where: { documentId: id },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
    orderBy: { invitedAt: "asc" },
  });

  return NextResponse.json({ collaborators });
}

// ─────────────────────────────────────────────
// POST — add collaborator by email
// Only OWNER can manage collaborators
// ─────────────────────────────────────────────

const AddCollaboratorSchema = z.object({
  email: z.string().email("Must be a valid email"),
  role: z.enum(["EDITOR", "VIEWER"]).default("VIEWER"),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (access.role !== "OWNER") {
    return NextResponse.json(
      { error: "Only the document owner can add collaborators" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = AddCollaboratorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 422 }
    );
  }

  const { email, role } = parsed.data;

  // Find user by email
  const targetUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });

  if (!targetUser) {
    return NextResponse.json(
      { error: "No user found with that email" },
      { status: 404 }
    );
  }

  // Cannot add self
  if (targetUser.id === user.id) {
    return NextResponse.json(
      { error: "You are already the owner of this document" },
      { status: 409 }
    );
  }

  // Upsert — update role if already a collaborator
  const collaborator = await prisma.collaborator.upsert({
    where: {
      documentId_userId: { documentId: id, userId: targetUser.id },
    },
    create: {
      documentId: id,
      userId: targetUser.id,
      role,
      acceptedAt: new Date(),
    },
    update: { role },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
  });

  writeAuditLog({
    userId: user.id,
    documentId: id,
    action: "COLLABORATOR_ADDED",
    metadata: { targetUserId: targetUser.id, role },
  });

  return NextResponse.json({ collaborator }, { status: 201 });
}

// ─────────────────────────────────────────────
// PATCH — update collaborator role
// ─────────────────────────────────────────────

const UpdateRoleSchema = z.object({
  userId: z.string().cuid(),
  role: z.enum(["EDITOR", "VIEWER"]),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (access.role !== "OWNER") {
    return NextResponse.json({ error: "Only owner can update roles" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateRoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }

  const { userId: targetUserId, role } = parsed.data;

  const collaborator = await prisma.collaborator.update({
    where: {
      documentId_userId: { documentId: id, userId: targetUserId },
    },
    data: { role },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ collaborator });
}

// ─────────────────────────────────────────────
// DELETE — remove collaborator
// ─────────────────────────────────────────────

const RemoveCollaboratorSchema = z.object({
  userId: z.string().cuid(),
});

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Owner can remove anyone; editors/viewers can only remove themselves
  const body = await req.json().catch(() => ({}));
  const parsed = RemoveCollaboratorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }

  const { userId: targetUserId } = parsed.data;

  if (access.role !== "OWNER" && targetUserId !== user.id) {
    return NextResponse.json(
      { error: "You can only remove yourself" },
      { status: 403 }
    );
  }

  await prisma.collaborator.delete({
    where: {
      documentId_userId: { documentId: id, userId: targetUserId },
    },
  });

  writeAuditLog({
    userId: user.id,
    documentId: id,
    action: "COLLABORATOR_REMOVED",
    metadata: { targetUserId },
  });

  return NextResponse.json({ ok: true });
}
