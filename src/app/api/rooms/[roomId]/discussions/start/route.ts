import { NextResponse } from "next/server";
import { getRoom, startDiscussion } from "@/domain/room-store";
import { emitRoomUpdated } from "@/realtime/events";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const { roomId } = await params;
  const current = await getRoom(roomId);

  if (!current) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  if (current.agents.length === 0) {
    return NextResponse.json({ error: "agent_required" }, { status: 409 });
  }

  const room = await startDiscussion(roomId);

  if (!room) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  emitRoomUpdated(room);

  return NextResponse.json(room);
}