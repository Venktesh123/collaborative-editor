// src/app/api/documents/[id]/sync/route.ts
// POST /api/documents/:id/sync
//
// This is the most critical endpoint in the system.
// It handles the "offline-first sync" use case:
//   1. Client was offline, made changes, came back online
//   2. Client POSTs batched operations with baseRevision
//   3. Server fetches all ops committed since baseRevision
//   4. Server transforms (rebases) client ops via OT
//   5. Server applies rebased ops and returns missing ops to client
//
// Security hardening:
//   - Raw body size check BEFORE JSON.parse (OOM prevention)
//   - Zod schema validation
//   - Semantic validation (position bounds, duplicate IDs)
//   - Payload size stored for audit
//   - Rate limiting
//   - Role enforcement (VIEWER cannot push ops)
//   - Row-level isolation (user must have access)
//   - Idempotent op IDs (safe retries)

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma, getDocumentForUser, writeAuditLog } from "@/lib/prisma";
import { validateSyncPayload, estimateNewDocumentSize } from "@/lib/sync-engine/validator";
import { rebaseOps, applyOperations, deduplicateOps } from "@/lib/sync-engine/ot";
import { applyRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { SYNC_LIMITS } from "@/types/sync";
import { mergeClock } from "@/types/document";
import type { SyncResponse } from "@/types/sync";
import type { Operation, VectorClock, DocumentContent } from "@/types/document";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  // ── 1. Auth ──────────────────────────────────────────────────────────
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── 2. Rate limit ────────────────────────────────────────────────────
  const rateLimitResponse = applyRateLimit(req, user.id, RATE_LIMITS.SYNC);
  if (rateLimitResponse) return rateLimitResponse;

  const { id: documentId } = await params;

  // ── 3. Authorization + document fetch ────────────────────────────────
  const access = await getDocumentForUser(documentId, user.id);
  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (access.role === "VIEWER") {
    return NextResponse.json(
      { error: "Viewers cannot push sync updates" },
      { status: 403 }
    );
  }

  // ── 4. Raw body extraction + size guard ──────────────────────────────
  // We read as text FIRST so we can check byte size before JSON.parse.
  // This prevents a malicious actor sending a gigantic JSON that would
  // OOM the process during parsing.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }

  // ── 5. Validate payload ───────────────────────────────────────────────
  const currentContent = access.doc.content as DocumentContent;
  const currentTextLength = currentContent.text?.length ?? 0;

  const validation = validateSyncPayload(rawBody, currentTextLength);
  if (!validation.ok) {
    writeAuditLog({
      userId: user.id,
      documentId,
      action: "SYNC_REJECTED",
      metadata: { reason: validation.error, details: validation.details },
    });
    return NextResponse.json(
      { error: validation.error, details: validation.details },
      { status: validation.status }
    );
  }

  const { payload } = validation;
  const { ops: clientOps, baseRevision, vectorClock: clientClock, requestResync } = payload;

  // ── 6. Verify all ops claim the correct authorId ──────────────────────
  const unauthorizedOp = clientOps.find((op) => op.authorId !== user.id);
  if (unauthorizedOp) {
    return NextResponse.json(
      { error: "Operation authorId does not match authenticated user" },
      { status: 422 }
    );
  }

  // ── 7. Transactional sync apply ────────────────────────────────────────
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the document row for this transaction (prevents concurrent sync races)
      const lockedDoc = await tx.$queryRaw<
        Array<{
          id: string;
          revision: number;
          content: unknown;
          vector_clock: unknown;
          content_size: number;
        }>
      >`SELECT id, revision, content, vector_clock, content_size
        FROM documents WHERE id = ${documentId} FOR UPDATE NOWAIT`;

      if (!lockedDoc[0]) throw new Error("Document not found");

      const doc = lockedDoc[0];
      const serverRevision = doc.revision;
      const currentDocContent = doc.content as DocumentContent;
      const serverClock = (doc.vector_clock ?? {}) as VectorClock;
      const currentText = currentDocContent.text ?? "";

      // Fetch all ops committed after client's baseRevision
      const serverOpsSince = await tx.operationLog.findMany({
        where: {
          documentId,
          revision: { gt: baseRevision },
        },
        orderBy: { revision: "asc" },
        select: { payload: true, clientOpId: true, revision: true },
      });

      const serverOps = serverOpsSince.map((r) => r.payload as Operation);

      // Deduplicate: skip ops the server already has
      const existingIds = new Set(serverOpsSince.map((r) => r.clientOpId));
      const newClientOps = deduplicateOps(clientOps, existingIds);

      if (newClientOps.length === 0) {
        // All ops already applied (idempotent retry) — return current state
        return {
          type: "already_applied" as const,
          serverRevision,
          serverClock,
          missingOps: serverOps,
          fullContent: currentDocContent,
        };
      }

      // OT rebase: transform client ops against server ops
      const rebasedOps = rebaseOps(newClientOps, serverOps);

      // Apply to produce new text
      const newText = applyOperations(currentText, rebasedOps);

      // Document size guard
      const estimatedSize = estimateNewDocumentSize(
        doc.content_size ?? 0,
        rebasedOps
      );
      if (estimatedSize > SYNC_LIMITS.MAX_DOCUMENT_SIZE_BYTES) {
        throw new SyncError("Document size limit exceeded", 413);
      }

      const newRevision = serverRevision + 1;
      const newClock = mergeClock(serverClock, clientClock);
      const newSize = Buffer.byteLength(newText, "utf-8");

      // Persist rebased ops to immutable log
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

      // Update document state
      const newContent: DocumentContent = {
        ops: rebasedOps,
        text: newText,
        metadata: {
          wordCount: newText.split(/\s+/).filter(Boolean).length,
          charCount: newText.length,
          lastEditedBy: user.id,
        },
      };

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

      // Log sync in queue for debugging/replay
      await tx.syncQueueEntry.create({
        data: {
          documentId,
          authorId: user.id,
          payload: payload as object,
          status: "APPLIED",
          payloadSize: Buffer.byteLength(rawBody, "utf-8"),
          processedAt: new Date(),
        },
      });

      return {
        type: "applied" as const,
        newRevision,
        newClock,
        rebasedOps,
        missingOps: serverOps, // Send these so client can catch up
        fullContent: requestResync ? newContent : undefined,
      };
    });

    // ── 8. Build response ──────────────────────────────────────────────

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

    writeAuditLog({
      userId: user.id,
      documentId,
      action: "SYNC_APPLIED",
      metadata: { opsCount: result.rebasedOps.length, newRevision: result.newRevision },
    });

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
    if (err instanceof SyncError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    // PostgreSQL lock timeout — another sync is in progress
    if (
      err instanceof Error &&
      err.message.includes("could not obtain lock")
    ) {
      return NextResponse.json(
        { error: "Document is currently being synced. Retry in a moment." },
        { status: 409 }
      );
    }

    console.error("[SYNC] Transaction error", err);
    writeAuditLog({
      userId: user.id,
      documentId,
      action: "SYNC_REJECTED",
      metadata: { reason: String(err) },
    });

    return NextResponse.json(
      { error: "Sync failed due to an internal error" },
      { status: 500 }
    );
  }
}

class SyncError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "SyncError";
  }
}
