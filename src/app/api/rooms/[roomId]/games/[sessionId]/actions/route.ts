import { NextResponse } from "next/server";
import { submitGameAction } from "@/domain/games/orchestrator";
import { sanitizeForViewer } from "@/domain/game-store";
import { emitGameUpdated } from "@/realtime/events";

type RouteContext = {
  params: Promise<{ roomId: string; sessionId: string }>;
};

const errorStatus: Record<string, number> = {
  session_not_found: 404,
  actor_not_in_game: 403,
  action_not_allowed_in_phase: 409,
  action_type_unknown: 400,
  target_invalid: 400,
  actor_not_alive: 409,
  already_ended: 409,
  role_not_allowed: 403,
  text_required: 400,
};

export async function POST(request: Request, { params }: RouteContext) {
  const { roomId, sessionId } = await params;
  const body = await request.json().catch(() => null);

  const type = typeof body?.type === "string" ? body.type.trim() : "";
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : undefined;
  const payload = body?.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : {};

  if (!type) return NextResponse.json({ error: "action_type_unknown" }, { status: 400 });
  if (!actorId) return NextResponse.json({ error: "actor_not_in_game" }, { status: 403 });

  const result = await submitGameAction(roomId, sessionId, { type, actorId, targetId, payload });

  if (result.error || !result.session) {
    return NextResponse.json({ error: result.error ?? "submit_failed" }, { status: errorStatus[result.error ?? ""] ?? 400 });
  }

  emitGameUpdated(result.session);
  return NextResponse.json({ session: sanitizeForViewer(result.session, actorId) });
}