import { NextResponse } from "next/server";
import { addAgent } from "@/domain/room-store";
import { emitRoomUpdated } from "@/realtime/events";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim() : "";
  const persona = typeof body?.persona === "string" ? body.persona.trim() : undefined;
  const goal = typeof body?.goal === "string" ? body.goal.trim() : undefined;
  const provider = typeof body?.provider === "string" ? body.provider.trim() : undefined;
  const model = typeof body?.model === "string" ? body.model.trim() : undefined;

  if (!name || !role) {
    return NextResponse.json({ error: "agent_name_and_role_required" }, { status: 400 });
  }

  const room = await addAgent(roomId, { name, role, persona, goal, provider, model });

  if (!room) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  emitRoomUpdated(room);

  return NextResponse.json(room, { status: 201 });
}