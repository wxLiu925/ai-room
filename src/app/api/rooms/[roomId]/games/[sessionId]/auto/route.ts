import { NextResponse } from "next/server";
import { autoStepGame } from "@/domain/games/orchestrator";
import { sanitizeForViewer } from "@/domain/game-store";
import { emitGameUpdated } from "@/realtime/events";

type RouteContext = {
  params: Promise<{ roomId: string; sessionId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  const { roomId, sessionId } = await params;
  const viewerId = new URL(request.url).searchParams.get("viewerId") ?? undefined;

  const session = await autoStepGame(roomId, sessionId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });

  emitGameUpdated(session);
  return NextResponse.json({ session: sanitizeForViewer(session, viewerId) });
}