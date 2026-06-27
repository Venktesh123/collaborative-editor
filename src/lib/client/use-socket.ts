// src/lib/client/use-socket.ts
// React hook for Socket.IO real-time collaboration.
// Manages connection lifecycle, room joining, and event subscription.

"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { ServerToClientEvents, ClientToServerEvents } from "@/types/sync";
import type { Operation, VectorClock } from "@/types/document";

type CollabSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseSocketOptions {
  documentId: string;
  onOpsReceived: (ops: Operation[], revision: number, clock: VectorClock) => void;
  onPresenceUpdate: (data: {
    userId: string;
    name: string;
    cursor?: { position: number };
    status: "online" | "offline" | "idle";
  }) => void;
  onConnectionChange: (connected: boolean) => void;
}

export function useCollabSocket({
  documentId,
  onOpsReceived,
  onPresenceUpdate,
  onConnectionChange,
}: UseSocketOptions) {
  const socketRef = useRef<CollabSocket | null>(null);

  useEffect(() => {
    const socketUrl =
      process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3000";

    const socket: CollabSocket = io(socketUrl, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      onConnectionChange(true);
      socket.emit("room:join", documentId);
    });

    socket.on("disconnect", () => {
      onConnectionChange(false);
    });

    socket.on("ops:broadcast", ({ ops, revision, vectorClock }) => {
      onOpsReceived(ops, revision, vectorClock);
    });

    socket.on("presence:update", (data) => {
      onPresenceUpdate(data);
    });

    socket.on("document:locked", ({ reason }) => {
      console.warn("[Socket] Document locked:", reason);
    });

    return () => {
      socket.emit("room:leave", documentId);
      socket.disconnect();
    };
  }, [documentId]);

  const submitOps = useCallback(
    (
      ops: Operation[],
      baseRevision: number,
      vectorClock: VectorClock
    ): Promise<{ ok: boolean; revision?: number; error?: string }> => {
      return new Promise((resolve) => {
        if (!socketRef.current?.connected) {
          resolve({ ok: false, error: "Not connected" });
          return;
        }

        socketRef.current.emit(
          "ops:submit",
          { documentId, ops, baseRevision, vectorClock },
          (result) => resolve(result)
        );
      });
    },
    [documentId]
  );

  const sendCursorPosition = useCallback((position: number) => {
    socketRef.current?.emit("presence:cursor", { documentId, position });
  }, [documentId]);

  return { submitOps, sendCursorPosition };
}
