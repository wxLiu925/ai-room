import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = Number.parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

await app.prepare();

const httpServer = createServer(handler);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

globalThis.aiRoomRealtime = {
  emitRoom(roomId, event, payload) {
    io.to(roomId).emit(event, payload);
  },
};

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, lastSeq }) => {
    if (typeof roomId !== "string" || !roomId) return;

    socket.join(roomId);
    socket.emit("room:joined", { roomId, lastSeq: Number(lastSeq) || 0 });
  });

  socket.on("room:leave", ({ roomId }) => {
    if (typeof roomId !== "string" || !roomId) return;

    socket.leave(roomId);
  });
});

httpServer.listen(port, () => {
  console.log(`Ready on http://${hostname}:${port}`);
});