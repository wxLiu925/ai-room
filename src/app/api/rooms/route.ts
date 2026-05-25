import { NextResponse } from "next/server";
import { createRoom, listRooms } from "@/domain/room-store";

export async function GET() {
  return NextResponse.json({ rooms: await listRooms() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const ownerName = typeof body?.ownerName === "string" ? body.ownerName.trim() : undefined;
  const mode = body?.mode === "werewolf" ? "werewolf" : "discussion";

  if (!title) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }

  return NextResponse.json(await createRoom({ title, ownerName, mode }), { status: 201 });
}