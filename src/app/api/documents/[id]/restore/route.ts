// src/app/api/documents/[id]/restore/route.ts
// POST /api/documents/:id/restore
//
// "Time travel" restore — restores a document to a previous version snapshot.
//
// Safety design:
//   1. We do NOT overwrite the document in-place with the old snapshot.
//      Instead, we compute a REPLACE operation from current→snapshot text
//      and push it through the normal OT pipeline.
//   2. This means any collaborators currently editing will see the restore
//      as a normal op — their pending local changes will be rebased on top
//      of the restore op, not silently discarded.
//   3. We also auto-create a "pre-restore" version snapshot so the user
//      can undo the restore if needed.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "@/lib/auth";
import { prisma, getDocumentForUser, writeAuditLog } from "@/lib/prisma";
import type { DocumentContent, VectorClock } from "@/types/document";
import { mergeClock, incrementClock } from "@/types/document";

type Params = { params: Promise<{ id: string }> };

const RestoreSchema = z.object({
  versionId: z.string().cuid("versionId must be a valid CUID"),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: documentId } = await params;

  // ── Authorization ──────────────────────────────────────────────────
  const access = await getDocumentForUser(documentId, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only OWNER or EDITOR can restore
  if (access.role === "VIEWER") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // ── Validate request body ──────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const parsed = RestoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 422 }
    );
  }

  const { versionId } = parsed.data;

  // ── Fetch target version ───────────────────────────────────────────
  const targetVersion = await prisma.documentVersion.findFirst({
    where: { id: versionId, documentId },
  });

  if (!targetVersion) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  // ── Execute restore in a transaction ──────────────────────────────
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock document
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          revision: number;
          content: unknown;
          vector_clock: unknown;
          content_size: number;
        }>
      >`SELECT id, revision, content, vector_clock, content_size
        FROM documents WHERE id = ${documentId} FOR UPDATE`;

      if (!locked[0]) throw new Error("Document not found");

      const current = locked[0];
      const currentContent = current.content as DocumentContent;
      const currentText = currentContent.text ?? "";
      const serverRevision = current.revision;
      const serverClock = (current.vector_clock ?? {}) as VectorClock;

      // Step 1: Auto-snapshot current state as "pre-restore" checkpoint
      await tx.documentVersion.create({
        data: {
          documentId,
          createdById: user.id,
          snapshot: current.content as object,
          revision: serverRevision,
          label: `Before restore to: ${targetVersion.label ?? targetVersion.id.slice(0, 8)}`,
        },
      });

      // Step 2: Compute the restore as a single REPLACE operation
      // This goes through the OT log so collaborators can rebase against it
      const restoredContent = targetVersion.snapshot as unknown as DocumentContent;
      const restoredText = restoredContent.text ?? "";
      const newRevision = serverRevision + 1;

      const restoreOpId = uuidv4();
      const newClock = incrementClock(
        mergeClock(serverClock, {}),
        user.id
      );

      const restoreOp = {
        type: "REPLACE" as const,
        position: 0,
        length: currentText.length,
        content: restoredText,
        clientOpId: restoreOpId,
        baseRevision: serverRevision,
        authorId: user.id,
        timestamp: Date.now(),
      };

      // Write restore op to immutable log
      await tx.operationLog.create({
        data: {
          documentId,
          authorId: user.id,
          type: "REPLACE",
          payload: restoreOp as object,
          baseRevision: serverRevision,
          revision: newRevision,
          clientOpId: restoreOpId,
        },
      });

      // Build new content from restored snapshot (preserve metadata)
      const newContent: DocumentContent = {
        ops: [restoreOp],
        text: restoredText,
        metadata: {
          wordCount: restoredText.split(/\s+/).filter(Boolean).length,
          charCount: restoredText.length,
          lastEditedBy: user.id,
        },
      };

      const newSize = Buffer.byteLength(restoredText, "utf-8");

      await tx.document.update({
        where: { id: documentId },
        data: {
          content: newContent as unknown as object,
          revision: newRevision,
          vectorClock: newClock,
          contentSize: newSize,
          updatedAt: new Date(),
        },
      });

      return {
        newRevision,
        newClock,
        restoreOp,
        newContent,
      };
    });

    writeAuditLog({
      userId: user.id,
      documentId,
      action: "VERSION_RESTORED",
      metadata: {
        versionId,
        targetRevision: targetVersion.revision,
        newRevision: result.newRevision,
      },
    });

    return NextResponse.json({
      ok: true,
      newRevision: result.newRevision,
      vectorClock: result.newClock,
      // Return the restore op so connected WS clients can receive it
      // via the normal "ops:broadcast" channel
      restoreOp: result.restoreOp,
      content: result.newContent,
    });
  } catch (err) {
    console.error("[RESTORE] Error", err);
    return NextResponse.json(
      { error: "Restore failed" },
      { status: 500 }
    );
  }
}
