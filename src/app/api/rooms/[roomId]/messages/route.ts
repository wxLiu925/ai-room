import { NextResponse } from "next/server";
import { addMessage } from "@/domain/room-store";
import { emitRoomUpdated } from "@/realtime/events";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";

  if (!content) {
    return NextResponse.json({ error: "content_required" }, { status: 400 });
  }

  const room = await addMessage(roomId, { content });

  if (!room) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  emitRoomUpdated(room);

  return NextResponse.json(room, { status: 201 });
}