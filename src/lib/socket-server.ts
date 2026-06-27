// src/lib/socket-server.ts
// Socket.IO real-time collaboration server.
//
// Responsibilities:
//   - Authenticate socket connections via JWT
//   - Manage document "rooms" (one room per documentId)
//   - Broadcast ops from one client to all others in the room
//   - Track presence (cursor positions, online users)
//   - Enforce role-based write access (VIEWERs cannot push ops)

import { Server as HTTPServer } from "http";
import { Server as SocketServer } from "socket.io";
import { rebaseOps, applyOperations } from "./sync-engine/ot";
import { getToken } from "next-auth/jwt";
import type { IncomingMessage } from "http";
import { prisma } from "./prisma";
import { validateSyncPayload, estimateNewDocumentSize } from "./sync-engine/validator";
import { SYNC_LIMITS } from "@/types/sync";
import type { ServerToClientEvents, ClientToServerEvents } from "@/types/sync";
import type { Operation, VectorClock } from "@/types/document";
import { mergeClock } from "@/types/document";

// Extend socket data types
interface SocketData {
  userId: string;
  userName: string;
  documentId?: string;
}

// ─────────────────────────────────────────────
// PRESENCE STORE
// In-memory per-document presence map.
// Replace with Redis pub/sub for multi-instance.
// ─────────────────────────────────────────────

interface PresenceEntry {
  userId: string;
  name: string;
  cursor?: { position: number };
  socketId: string;
  lastSeen: number;
}

const presenceStore = new Map<string, Map<string, PresenceEntry>>();

function getDocPresence(documentId: string): Map<string, PresenceEntry> {
  if (!presenceStore.has(documentId)) {
    presenceStore.set(documentId, new Map());
  }
  return presenceStore.get(documentId)!;
}

// ─────────────────────────────────────────────
// SERVER FACTORY
// ─────────────────────────────────────────────

export function createSocketServer(httpServer: HTTPServer): SocketServer {
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(
    httpServer,
    {
      cors: {
        origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        credentials: true,
      },
      // Limit incoming message size to prevent OOM
      maxHttpBufferSize: SYNC_LIMITS.MAX_PAYLOAD_BYTES,
    }
  );

  // ── Authentication middleware ──────────────────────────────────────

  io.use(async (socket, next) => {
    try {
      // Extract JWT from cookie or Authorization header
      const token = await getToken({
        req: socket.request as IncomingMessage & { cookies: Record<string, string> },
        secret: process.env.NEXTAUTH_SECRET!,
      });

      if (!token?.userId) {
        return next(new Error("Authentication required"));
      }

      const user = await prisma.user.findUnique({
        where: { id: token.userId as string },
        select: { id: true, name: true, email: true },
      });

      if (!user) return next(new Error("User not found"));

      socket.data.userId = user.id;
      socket.data.userName = user.name ?? user.email;
      next();
    } catch (err) {
      next(new Error("Auth error"));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────

  io.on("connection", (socket) => {
    console.log(`[WS] User ${socket.data.userId} connected`);

    // ── Join document room ───────────────────────────────────────────

    socket.on("room:join", async (documentId) => {
      // Verify user has access to this document
      const access = await getUserDocumentRole(socket.data.userId, documentId);
      if (!access) {
        socket.emit("document:locked", { reason: "Access denied" });
        return;
      }

      socket.join(documentId);
      socket.data.documentId = documentId;

      // Register presence
      const presence = getDocPresence(documentId);
      presence.set(socket.data.userId, {
        userId: socket.data.userId,
        name: socket.data.userName,
        socketId: socket.id,
        lastSeen: Date.now(),
      });

      // Broadcast presence to room
      socket.to(documentId).emit("presence:update", {
        userId: socket.data.userId,
        name: socket.data.userName,
        status: "online",
      });
    });

    // ── Leave document room ──────────────────────────────────────────

    socket.on("room:leave", (documentId) => {
      socket.leave(documentId);
      handleDisconnect(socket, documentId, io);
    });

    // ── Op submission via WebSocket ──────────────────────────────────
    // This is the "fast path" for real-time collaboration.
    // The HTTP sync endpoint is the "durable path" for offline sync.

    socket.on("ops:submit", async ({ documentId, ops, baseRevision, vectorClock }, ack) => {
      try {
        const userId = socket.data.userId;

        // 1. Check write permission
        const role = await getUserDocumentRole(userId, documentId);
        if (!role || role === "VIEWER") {
          return ack({ ok: false, error: "Insufficient permissions" });
        }

        // 2. Validate payload size
        const payloadStr = JSON.stringify({ ops, baseRevision, vectorClock });
        const byteSize = Buffer.byteLength(payloadStr, "utf-8");
        if (byteSize > SYNC_LIMITS.MAX_PAYLOAD_BYTES) {
          return ack({ ok: false, error: "Payload too large" });
        }

        // 3. Apply ops via database transaction
        const result = await applyOpsTransaction(
          documentId,
          userId,
          ops,
          baseRevision,
          vectorClock
        );

        if (!result.ok) {
          return ack({ ok: false, error: result.error });
        }

        // 4. Broadcast to other clients in the room
        socket.to(documentId).emit("ops:broadcast", {
          ops: result.rebasedOps,
          authorId: userId,
          revision: result.newRevision,
          vectorClock: result.vectorClock,
        });

        ack({ ok: true, revision: result.newRevision });
      } catch (err) {
        console.error("[WS] ops:submit error", err);
        ack({ ok: false, error: "Internal error" });
      }
    });

    // ── Cursor presence ──────────────────────────────────────────────

    socket.on("presence:cursor", ({ documentId, position }) => {
      const presence = getDocPresence(documentId);
      const entry = presence.get(socket.data.userId);
      if (entry) {
        entry.cursor = { position };
        entry.lastSeen = Date.now();
      }

      socket.to(documentId).emit("presence:update", {
        userId: socket.data.userId,
        name: socket.data.userName,
        cursor: { position },
        status: "online",
      });
    });

    // ── Disconnect ───────────────────────────────────────────────────

    socket.on("disconnect", () => {
      if (socket.data.documentId) {
        handleDisconnect(socket, socket.data.documentId, io);
      }
    });
  });

  return io;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function handleDisconnect(
  socket: { data: SocketData; id: string },
  documentId: string,
  io: SocketServer
) {
  const presence = getDocPresence(documentId);
  presence.delete(socket.data.userId);

  io.to(documentId).emit("presence:update", {
    userId: socket.data.userId,
    name: socket.data.userName,
    status: "offline",
  });

  // Clean up empty presence maps
  if (presence.size === 0) presenceStore.delete(documentId);
}

async function getUserDocumentRole(
  userId: string,
  documentId: string
): Promise<"OWNER" | "EDITOR" | "VIEWER" | null> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, isDeleted: false },
    select: {
      ownerId: true,
      collaborators: {
        where: { userId },
        select: { role: true },
      },
    },
  });

  if (!doc) return null;
  if (doc.ownerId === userId) return "OWNER";
  return (doc.collaborators[0]?.role as "EDITOR" | "VIEWER") ?? null;
}

async function applyOpsTransaction(
  documentId: string,
  userId: string,
  clientOps: Operation[],
  baseRevision: number,
  clientVectorClock: VectorClock
): Promise<
  | { ok: true; rebasedOps: Operation[]; newRevision: number; vectorClock: VectorClock }
  | { ok: false; error: string }
> {
  return prisma.$transaction(async (tx) => {
    // Lock and fetch current document state
    const doc = await tx.$queryRaw<
      Array<{ id: string; content: unknown; revision: number; vector_clock: unknown; content_size: number }>
    >`SELECT id, content, revision, vector_clock, content_size FROM documents WHERE id = ${documentId} FOR UPDATE`;

    if (!doc[0]) return { ok: false, error: "Document not found" };

    const current = doc[0];
    const currentContent = current.content as { text: string; ops: Operation[] };
    const serverRevision = current.revision;

    // Fetch ops committed after client's baseRevision for OT rebase
    const serverOpsSince = await tx.operationLog.findMany({
      where: {
        documentId,
        revision: { gt: baseRevision },
      },
      orderBy: { revision: "asc" },
      select: { payload: true },
    });

    const serverOps = serverOpsSince.map((r) => r.payload as Operation);

    // Rebase client ops against server ops (OT transform)
    const rebasedOps = rebaseOps(clientOps, serverOps);

    // Apply rebased ops to current text
    const newText = applyOperations(currentContent.text ?? "", rebasedOps);

    // Size guard — prevent unbounded document growth
    const newSize = Buffer.byteLength(newText, "utf-8");
    if (newSize > SYNC_LIMITS.MAX_DOCUMENT_SIZE_BYTES) {
      return { ok: false, error: "Document size limit exceeded" };
    }

    const newRevision = serverRevision + 1;
    const existingClock = (current.vector_clock ?? {}) as VectorClock;
    const newClock = mergeClock(existingClock, clientVectorClock);

    // Check for duplicate clientOpIds (idempotency)
    const clientOpIds = clientOps.map((op) => op.clientOpId);
    const existing = await tx.operationLog.findMany({
      where: { clientOpId: { in: clientOpIds } },
      select: { clientOpId: true },
    });
    const existingIds = new Set(existing.map((e) => e.clientOpId));
    const newOps = rebasedOps.filter(
      (op) => !existingIds.has(op.clientOpId)
    );

    if (newOps.length === 0) {
      // All ops already applied — return current state
      return {
        ok: true,
        rebasedOps: [],
        newRevision: serverRevision,
        vectorClock: existingClock,
      };
    }

    // Write ops to immutable log
    await tx.operationLog.createMany({
      data: newOps.map((op, i) => ({
        documentId,
        authorId: userId,
        type: op.type,
        payload: op as object,
        baseRevision,
        revision: serverRevision + i + 1,
        clientOpId: op.clientOpId,
      })),
    });

    // Update document state
    await tx.document.update({
      where: { id: documentId },
      data: {
        content: {
          ops: newOps,
          text: newText,
          metadata: {
            wordCount: newText.split(/\s+/).filter(Boolean).length,
            charCount: newText.length,
            lastEditedBy: userId,
          },
        },
        revision: newRevision,
        vectorClock: newClock,
        contentSize: newSize,
        updatedAt: new Date(),
      },
    });

    return {
      ok: true,
      rebasedOps,
      newRevision,
      vectorClock: newClock,
    };
  });
}

export type { PresenceEntry };
