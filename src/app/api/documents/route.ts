// src/app/api/documents/route.ts
// GET  /api/documents     — list all documents accessible by the user
// POST /api/documents     — create a new document

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { prisma, writeAuditLog } from "@/lib/prisma";
import { applyRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// ─────────────────────────────────────────────
// GET /api/documents
// ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await requireAuth().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pagination
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, parseInt(searchParams.get("limit") ?? "20", 10));
  const skip = (page - 1) * limit;

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where: {
        isDeleted: false,
        OR: [
          { ownerId: user.id },
          {
            collaborators: {
              some: { userId: user.id },
            },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
        ownerId: true,
        isPublic: true,
        owner: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        collaborators: {
          where: { userId: user.id },
          select: { role: true },
        },
        _count: {
          select: { collaborators: true, versions: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),

    prisma.document.count({
      where: {
        isDeleted: false,
        OR: [
          { ownerId: user.id },
          { collaborators: { some: { userId: user.id } } },
        ],
      },
    }),
  ]);

  const result = documents.map((doc) => ({
    ...doc,
    userRole: doc.ownerId === user.id ? "OWNER" : doc.collaborators[0]?.role ?? "VIEWER",
    collaborators: undefined, // Don't leak all collaborator data in list
  }));

  return NextResponse.json({
    documents: result,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// ─────────────────────────────────────────────
// POST /api/documents
// ─────────────────────────────────────────────

const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(255).default("Untitled Document"),
  isPublic: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const user = await requireAuth().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting
  const rateLimitResponse = applyRateLimit(req, user.id, RATE_LIMITS.DOCUMENTS);
  if (rateLimitResponse) return rateLimitResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = CreateDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 422 }
    );
  }

  const { title, isPublic } = parsed.data;

  const document = await prisma.document.create({
    data: {
      title,
      isPublic,
      ownerId: user.id,
      content: { ops: [], text: "", metadata: { wordCount: 0, charCount: 0 } },
      vectorClock: {},
      revision: 0,
    },
  });

  writeAuditLog({
    userId: user.id,
    documentId: document.id,
    action: "DOCUMENT_CREATED",
    metadata: { title },
    ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
  });

  return NextResponse.json({ document }, { status: 201 });
}
