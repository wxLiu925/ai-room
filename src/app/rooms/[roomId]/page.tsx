import { RoomClient } from "@/app/components/room-client";
import { getRoom } from "@/domain/store";
import { notFound } from "next/navigation";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  const room = getRoom(roomId);

  if (!room) {
    notFound();
  }

  return <RoomClient initialRoom={room} />;
}