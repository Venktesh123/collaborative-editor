// src/app/api/documents/[id]/versions/route.ts
// GET  /api/documents/:id/versions   — list version snapshots
// POST /api/documents/:id/versions   — create a named snapshot

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { prisma, getDocumentForUser, writeAuditLog } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────
// GET /api/documents/:id/versions
// ─────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      documentId: true,
      label: true,
      revision: true,
      createdAt: true,
      createdBy: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
      // NOTE: we intentionally omit `snapshot` from list view
      // to keep the payload small. Fetch individual version for full content.
    },
  });

  return NextResponse.json({ versions });
}

// ─────────────────────────────────────────────
// POST /api/documents/:id/versions
// Create a named snapshot of the current document state
// ─────────────────────────────────────────────

const CreateVersionSchema = z.object({
  label: z.string().min(1).max(255).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Viewers cannot create versions
  if (access.role === "VIEWER") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = CreateVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }

  const { doc } = access;

  // Create snapshot of CURRENT document state
  const version = await prisma.documentVersion.create({
    data: {
      documentId: id,
      createdById: user.id,
      snapshot: doc.content as object,
      revision: doc.revision,
      label:
        parsed.data.label ??
        `Version ${new Date().toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })}`,
    },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  writeAuditLog({
    userId: user.id,
    documentId: id,
    action: "VERSION_CREATED",
    metadata: { versionId: version.id, label: version.label },
  });

  return NextResponse.json({ version }, { status: 201 });
}
