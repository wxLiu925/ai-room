import { NextResponse } from "next/server";
import { activeSession } from "@/domain/games/orchestrator";
import { sanitizeForViewer } from "@/domain/game-store";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { roomId } = await params;
  const viewerId = new URL(request.url).searchParams.get("viewerId") ?? undefined;
  const session = activeSession(roomId);
  if (!session) return NextResponse.json({ session: null });
  return NextResponse.json({ session: sanitizeForViewer(session, viewerId) });
}