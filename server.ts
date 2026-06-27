// server.ts
// Custom Node.js server that combines Next.js and Socket.IO on one port.
//
// Why a custom server?
//   Next.js API routes run in a serverless model — they can't hold long-lived
//   WebSocket connections. We need Socket.IO on the same HTTP server so that:
//     1. Cookies/sessions from Next.js are accessible
//     2. Single port deployment (no CORS headaches)
//     3. We can share the Prisma client and business logic
//
// In production on Vercel: Socket.IO is hosted separately (e.g., Railway, Fly.io)
// and Next.js connects to it via NEXT_PUBLIC_SOCKET_URL env var.

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { createSocketServer } from "./src/lib/socket-server";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error handling request", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  // Attach Socket.IO to the same HTTP server
  const io = createSocketServer(httpServer);

  // Make Socket.IO instance accessible to Next.js API routes if needed
  // (e.g., to emit events from HTTP endpoints)
  (global as unknown as { io: typeof io }).io = io;

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.IO listening on same port`);
    console.log(`> Environment: ${process.env.NODE_ENV}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down gracefully...");
    httpServer.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });

    // Force exit after 10s if hanging
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
});
