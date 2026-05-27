import { NextResponse } from "next/server";
import { updateAgent } from "@/domain/room-store";
import { emitRoomUpdated } from "@/realtime/events";

type RouteContext = {
  params: Promise<{ roomId: string; agentId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const { roomId, agentId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const input: Record<string, unknown> = {};
  if (typeof body.name === "string") input.name = body.name.trim();
  if (typeof body.role === "string") input.role = body.role.trim();
  if (typeof body.persona === "string") input.persona = body.persona.trim();
  if (typeof body.goal === "string") input.goal = body.goal.trim();
  if (typeof body.provider === "string") input.provider = body.provider.trim();
  if (typeof body.model === "string") input.model = body.model.trim();
  if (typeof body.temperature === "number") input.temperature = body.temperature;
  if (typeof body.enabled === "boolean") input.enabled = body.enabled;

  const room = await updateAgent(roomId, agentId, input);
  if (!room) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  emitRoomUpdated(room);
  return NextResponse.json(room);
}