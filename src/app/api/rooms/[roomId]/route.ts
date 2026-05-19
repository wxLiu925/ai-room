import { NextResponse } from "next/server";
import { getRoom } from "@/domain/store";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { roomId } = await params;
  const room = getRoom(roomId);

  if (!room) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const afterSeq = Number(new URL(request.url).searchParams.get("afterSeq") ?? 0);
  const missingEvents = Number.isFinite(afterSeq) && afterSeq > 0 ? room.events.filter((event) => event.seq > afterSeq) : [];

  return NextResponse.json({ ...room, missingEvents });
}