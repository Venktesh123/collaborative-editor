// src/app/api/documents/[id]/content/route.ts
// PUT /api/documents/:id/content — simple full-text save

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { prisma, getDocumentForUser } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const ContentSchema = z.object({
  text: z.string().max(5 * 1024 * 1024),
});

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getDocumentForUser(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (access.role === "VIEWER") return NextResponse.json({ error: "Read only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = ContentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 422 });

  const { text } = parsed.data;
  const newRevision = access.doc.revision + 1;

  const updated = await prisma.document.update({
    where: { id },
    data: {
      content: {
        ops: [],
        text,
        metadata: {
          wordCount: text.split(/\s+/).filter(Boolean).length,
          charCount: text.length,
          lastEditedBy: user.id,
        },
      },
      revision: newRevision,
      contentSize: Buffer.byteLength(text, "utf-8"),
      updatedAt: new Date(),
    },
    select: { id: true, revision: true },
  });

  return NextResponse.json({ ok: true, revision: updated.revision });
}