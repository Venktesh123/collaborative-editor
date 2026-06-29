// src/lib/socket-server.ts
import { Server as HTTPServer } from "http";
import { Server as SocketServer } from "socket.io";
import { prisma } from "./prisma";
import { rebaseOps, applyOperations } from "./sync-engine/ot";
import { SYNC_LIMITS } from "@/types/sync";
import type { ServerToClientEvents, ClientToServerEvents } from "@/types/sync";
import type { Operation, VectorClock, DocumentContent } from "@/types/document";
import { mergeClock } from "@/types/document";

interface SocketData {
  userId: string;
  userName: string;
  documentId?: string;
}

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

export function createSocketServer(httpServer: HTTPServer): SocketServer {
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(
    httpServer,
    {
      cors: {
        origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        credentials: true,
      },
      maxHttpBufferSize: SYNC_LIMITS.MAX_PAYLOAD_BYTES,
    }
  );

  // Auth middleware using cookie token
  io.use(async (socket, next) => {
    try {
      // Get userId from handshake auth
      const userId = socket.handshake.auth?.userId as string | undefined;
      const userName = socket.handshake.auth?.userName as string | undefined;

      if (!userId) {
        return next(new Error("Authentication required"));
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      });

      if (!user) return next(new Error("User not found"));

      socket.data.userId = user.id;
      socket.data.userName = userName ?? user.name ?? user.email;
      next();
    } catch {
      next(new Error("Auth error"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[WS] User ${socket.data.userId} connected`);

    socket.on("room:join", async (documentId) => {
      const access = await getUserDocumentRole(socket.data.userId, documentId);
      if (!access) {
        socket.emit("document:locked", { reason: "Access denied" });
        return;
      }

      socket.join(documentId);
      socket.data.documentId = documentId;

      const presence = getDocPresence(documentId);
      presence.set(socket.data.userId, {
        userId: socket.data.userId,
        name: socket.data.userName,
        socketId: socket.id,
        lastSeen: Date.now(),
      });

      socket.to(documentId).emit("presence:update", {
        userId: socket.data.userId,
        name: socket.data.userName,
        status: "online",
      });
    });

    socket.on("room:leave", (documentId) => {
      socket.leave(documentId);
      handleDisconnect(socket, documentId, io);
    });

    socket.on("ops:submit", async ({ documentId, ops, baseRevision, vectorClock }, ack) => {
      try {
        const userId = socket.data.userId;
        const role = await getUserDocumentRole(userId, documentId);
        if (!role || role === "VIEWER") {
          return ack({ ok: false, error: "Insufficient permissions" });
        }

        const payloadStr = JSON.stringify({ ops, baseRevision, vectorClock });
        if (Buffer.byteLength(payloadStr) > SYNC_LIMITS.MAX_PAYLOAD_BYTES) {
          return ack({ ok: false, error: "Payload too large" });
        }

        const result = await applyOpsTransaction(documentId, userId, ops, baseRevision, vectorClock);

        if (!result.ok) {
          return ack({ ok: false, error: result.error });
        }

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

    socket.on("disconnect", () => {
      if (socket.data.documentId) {
        handleDisconnect(socket, socket.data.documentId, io);
      }
    });
  });

  return io;
}

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
    const doc = await tx.document.findUnique({
      where: { id: documentId },
      select: { id: true, content: true, revision: true, vectorClock: true, contentSize: true },
    });

    if (!doc) return { ok: false, error: "Document not found" };

    const currentContent = doc.content as unknown as DocumentContent;
    const serverRevision = doc.revision;

    const serverOpsSince = await tx.operationLog.findMany({
      where: { documentId, revision: { gt: baseRevision } },
      orderBy: { revision: "asc" },
      select: { payload: true },
    });

    const serverOps = serverOpsSince.map((r) => r.payload as unknown as Operation);
    const rebasedOps = rebaseOps(clientOps, serverOps);
    const newText = applyOperations(currentContent.text ?? "", rebasedOps);
    const newRevision = serverRevision + 1;
    const existingClock = (doc.vectorClock ?? {}) as VectorClock;
    const newClock = mergeClock(existingClock, clientVectorClock);
    const newSize = Buffer.byteLength(newText, "utf-8");

    if (newSize > SYNC_LIMITS.MAX_DOCUMENT_SIZE_BYTES) {
      return { ok: false, error: "Document size limit exceeded" };
    }

    await tx.operationLog.createMany({
      data: rebasedOps.map((op, i) => ({
        documentId,
        authorId: userId,
        type: op.type,
        payload: op as unknown as object,
        baseRevision,
        revision: serverRevision + i + 1,
        clientOpId: op.clientOpId,
      })),
      skipDuplicates: true,
    });

    const newContent: DocumentContent = {
      ops: rebasedOps,
      text: newText,
      metadata: {
        wordCount: newText.split(/\s+/).filter(Boolean).length,
        charCount: newText.length,
        lastEditedBy: userId,
      },
    };

    await tx.document.update({
      where: { id: documentId },
      data: {
        content: newContent as unknown as object,
        revision: newRevision,
        vectorClock: newClock as unknown as object,
        contentSize: newSize,
        updatedAt: new Date(),
      },
    });

    return { ok: true, rebasedOps, newRevision, vectorClock: newClock };
  });
}

export type { PresenceEntry };