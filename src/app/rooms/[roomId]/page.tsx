import { RoomClient } from "@/app/components/room-client";
import { WerewolfClient } from "@/app/components/werewolf-client";
import { getProviderClientConfig } from "@/domain/provider";
import { getRoom } from "@/domain/room-store";
import { notFound } from "next/navigation";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  const room = await getRoom(roomId);

  if (!room) {
    notFound();
  }

  if (room.room.mode === "werewolf") {
    return <WerewolfClient initialRoom={room} providerConfig={getProviderClientConfig()} />;
  }

  return <RoomClient initialRoom={room} providerConfig={getProviderClientConfig()} />;
}