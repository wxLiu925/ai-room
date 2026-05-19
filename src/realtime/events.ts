import type { RoomEvent, RoomView } from "@/domain/types";

type RealtimeGateway = {
  emitRoom(roomId: string, event: string, payload: unknown): void;
};

declare global {
  var aiRoomRealtime: RealtimeGateway | undefined;
}

export type RoomRealtimePayload = {
  room: RoomView;
  events: RoomEvent[];
};

export function emitRoomUpdated(room: RoomView, afterSeq = 0) {
  globalThis.aiRoomRealtime?.emitRoom(room.room.id, "room:updated", {
    room,
    events: room.events.filter((event) => event.seq > afterSeq),
  } satisfies RoomRealtimePayload);
}