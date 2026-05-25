import { NextResponse } from "next/server";
import { createGameForRoom } from "@/domain/games/orchestrator";
import { sanitizeForViewer } from "@/domain/game-store";
import { getRoom } from "@/domain/room-store";
import { emitGameUpdated } from "@/realtime/events";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  const { roomId } = await params;
  try {
    const room = await getRoom(roomId);
    if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

    const body = await request.json().catch(() => null);
    const gameType = typeof body?.gameType === "string" ? body.gameType.trim() : "werewolf";

    const result = await createGameForRoom({ roomId, gameType });
    if (result.error || !result.session) {
      return NextResponse.json({ error: result.error ?? "create_failed" }, { status: 409 });
    }

    emitGameUpdated(result.session);
    return NextResponse.json({ session: sanitizeForViewer(result.session) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("[api] create game failed", { roomId, error });
    return NextResponse.json({ error: `internal: ${message}` }, { status: 500 });
  }
}