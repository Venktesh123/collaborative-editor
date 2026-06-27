// src/app/api/documents/[id]/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma, getDocumentForUser } from "@/lib/prisma";
import { validateSyncPayload } from "@/lib/sync-engine/validator";
import { rebaseOps, applyOperations, deduplicateOps } from "@/lib/sync-engine/ot";
import { applyRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { SYNC_LIMITS } from "@/types/sync";
import { mergeClock } from "@/types/document";
import type { SyncResponse } from "@/types/sync";
import type { Operation, VectorClock, DocumentContent } from "@/types/document";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  // 1. Auth
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 2. Rate limit
  const rateLimitResponse = applyRateLimit(req, user.id, RATE_LIMITS.SYNC);
  if (rateLimitResponse) return rateLimitResponse;

  const { id: documentId } = await params;

  // 3. Authorization
  const access = await getDocumentForUser(documentId, user.id);
  if (!access) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  if (access.role === "VIEWER") {
    return NextResponse.json({ error: "Viewers cannot push sync updates" }, { status: 403 });
  }

  // 4. Read raw body
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }

  // 5. Validate payload
  const currentContent = access.doc.content as DocumentContent;
  const currentTextLength = currentContent.text?.length ?? 0;

  const validation = validateSyncPayload(rawBody, currentTextLength);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, details: validation.details },
      { status: validation.status }
    );
  }

  const { payload } = validation;
  const { ops: clientOps, baseRevision, vectorClock: clientClock, requestResync } = payload;

  // 6. Verify authorId matches session
  const unauthorizedOp = clientOps.find((op) => op.authorId !== user.id);
  if (unauthorizedOp) {
    return NextResponse.json(
      { error: "Operation authorId does not match authenticated user" },
      { status: 422 }
    );
  }

  try {
    // 7. Use regular transaction (no FOR UPDATE NOWAIT — not supported on all Render tiers)
    const result = await prisma.$transaction(async (tx) => {
      // Fetch current document
      const doc = await tx.document.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          revision: true,
          content: true,
          vectorClock: true,
          contentSize: true,
        },
      });

      if (!doc) throw new Error("Document not found");

      const serverRevision = doc.revision;
      const currentDocContent = doc.content as DocumentContent;
      const serverClock = (doc.vectorClock ?? {}) as VectorClock;
      const currentText = currentDocContent.text ?? "";

      // Fetch ops since client's baseRevision
      const serverOpsSince = await tx.operationLog.findMany({
        where: { documentId, revision: { gt: baseRevision } },
        orderBy: { revision: "asc" },
        select: { payload: true, clientOpId: true },
      });

      const serverOps = serverOpsSince.map((r) => r.payload as Operation);
      const existingIds = new Set(serverOpsSince.map((r) => r.clientOpId));

      // Deduplicate
      const newClientOps = deduplicateOps(clientOps, existingIds);

      if (newClientOps.length === 0) {
        return {
          type: "already_applied" as const,
          serverRevision,
          serverClock,
          missingOps: serverOps,
          fullContent: currentDocContent,
        };
      }

      // OT rebase
      const rebasedOps = rebaseOps(newClientOps, serverOps);

      // Apply ops to text
      const newText = applyOperations(currentText, rebasedOps);

      // Size guard
      const newSize = Buffer.byteLength(newText, "utf-8");
      if (newSize > SYNC_LIMITS.MAX_DOCUMENT_SIZE_BYTES) {
        throw new Error("Document size limit exceeded");
      }

      const newRevision = serverRevision + 1;
      const newClock = mergeClock(serverClock, clientClock);

      // Write ops to log
      await tx.operationLog.createMany({
        data: rebasedOps.map((op, i) => ({
          documentId,
          authorId: user.id,
          type: op.type,
          payload: op as object,
          baseRevision,
          revision: serverRevision + i + 1,
          clientOpId: op.clientOpId,
        })),
        skipDuplicates: true,
      });

      // Build new content
      const newContent: DocumentContent = {
        ops: rebasedOps,
        text: newText,
        metadata: {
          wordCount: newText.split(/\s+/).filter(Boolean).length,
          charCount: newText.length,
          lastEditedBy: user.id,
        },
      };

      // Update document
      await tx.document.update({
        where: { id: documentId },
        data: {
          content: newContent,
          revision: newRevision,
          vectorClock: newClock,
          contentSize: newSize,
          updatedAt: new Date(),
        },
      });

      return {
        type: "applied" as const,
        newRevision,
        newClock,
        rebasedOps,
        missingOps: serverOps,
        fullContent: requestResync ? newContent : undefined,
      };
    });

    // Build response
    if (result.type === "already_applied") {
      const response: SyncResponse = {
        ok: true,
        newRevision: result.serverRevision,
        missingOps: result.missingOps,
        vectorClock: result.serverClock,
        fullContent: requestResync ? result.fullContent : undefined,
        opResults: clientOps.map((op) => ({
          clientOpId: op.clientOpId,
          status: "ALREADY_APPLIED",
        })),
      };
      return NextResponse.json(response);
    }

    const response: SyncResponse = {
      ok: true,
      newRevision: result.newRevision,
      missingOps: result.missingOps,
      vectorClock: result.newClock,
      fullContent: result.fullContent,
      opResults: clientOps.map((op) => ({
        clientOpId: op.clientOpId,
        status: "APPLIED",
      })),
    };

    return NextResponse.json(response);

  } catch (err) {
    console.error("[SYNC] Error:", err);
    return NextResponse.json(
      { error: "Sync failed: " + (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}