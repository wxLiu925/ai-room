import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = Number.parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

function roomPayload(value) {
  const payload = value && typeof value === "object" ? value : {};
  const roomId = typeof payload.roomId === "string" ? payload.roomId.trim() : "";
  const lastSeq = Number(payload.lastSeq);

  return {
    roomId,
    lastSeq: Number.isFinite(lastSeq) && lastSeq > 0 ? lastSeq : 0,
  };
}

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
  socket.on("room:join", (value) => {
    const { roomId, lastSeq } = roomPayload(value);
    if (!roomId) return;

    socket.join(roomId);
    socket.emit("room:joined", { roomId, lastSeq });
  });

  socket.on("room:leave", (value) => {
    const { roomId } = roomPayload(value);
    if (!roomId) return;

    socket.leave(roomId);
  });
});

httpServer.listen(port, hostname, () => {
  console.log(`Ready on http://${hostname}:${port}`);
});