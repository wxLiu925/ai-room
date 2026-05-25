import { NextResponse } from "next/server";
import { viewerSession } from "@/domain/games/orchestrator";

type RouteContext = {
  params: Promise<{ roomId: string; sessionId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const viewerId = new URL(request.url).searchParams.get("viewerId") ?? undefined;
  const session = viewerSession(sessionId, viewerId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  return NextResponse.json({ session });
}