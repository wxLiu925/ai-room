import type { Prisma } from "@prisma/client";
import { defaultModelForProvider, generateAgentReply, getProviderPublicConfig, normalizeProvider, providerMetadata } from "./provider";
import { getPrisma } from "./prisma";
import { ROOM_LIMITS } from "./store";
import type { Agent, Message, Participant, Room, RoomEvent, RoomView } from "./types";

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cleanText(value: string | undefined, maxLength: number) {
  return (value ?? "").trim().slice(0, maxLength);
}

function dateString(value: Date) {
  return value.toISOString();
}

function recordJson(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

type DbRoom = {
  id: string;
  title: string;
  mode: string;
  status: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
};

type DbParticipant = {
  id: string;
  roomId: string;
  kind: string;
  userId: string | null;
  agentId: string | null;
  name: string;
  status: string;
  createdAt: Date;
};

type DbAgent = {
  id: string;
  name: string;
  role: string;
  persona: string;
  goal: string;
  provider: string;
  model: string;
  temperature: number;
  enabled: boolean;
};

type DbMessage = {
  id: string;
  roomId: string;
  senderKind: string;
  senderId: string | null;
  type: string;
  content: string;
  status: string;
  seq: number;
  metadata: Prisma.JsonValue;
  createdAt: Date;
};

type DbEvent = {
  id: string;
  roomId: string;
  seq: number;
  type: string;
  actorId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

type RoomWithRelations = DbRoom & {
  participants: (DbParticipant & { agent: DbAgent | null })[];
  messages: DbMessage[];
  events: DbEvent[];
};

function toRoom(room: DbRoom): Room {
  return {
    id: room.id,
    title: room.title,
    mode: room.mode as Room["mode"],
    status: room.status as Room["status"],
    ownerId: room.ownerId,
    createdAt: dateString(room.createdAt),
    updatedAt: dateString(room.updatedAt),
  };
}

function toParticipant(participant: DbParticipant): Participant {
  return {
    id: participant.id,
    roomId: participant.roomId,
    kind: participant.kind as Participant["kind"],
    userId: participant.userId ?? undefined,
    agentId: participant.agentId ?? undefined,
    name: participant.name,
    status: participant.status as Participant["status"],
    createdAt: dateString(participant.createdAt),
  };
}

function toAgent(agent: DbAgent): Agent {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    persona: agent.persona,
    goal: agent.goal,
    provider: normalizeProvider(agent.provider),
    model: agent.model,
    temperature: agent.temperature,
    enabled: agent.enabled,
  };
}

function toMessage(message: DbMessage): Message {
  return {
    id: message.id,
    roomId: message.roomId,
    senderKind: message.senderKind as Message["senderKind"],
    senderId: message.senderId ?? undefined,
    type: message.type as Message["type"],
    content: message.content,
    status: message.status as Message["status"],
    seq: message.seq,
    metadata: recordJson(message.metadata),
    createdAt: dateString(message.createdAt),
  };
}

function toEvent(event: DbEvent): RoomEvent {
  return {
    id: event.id,
    roomId: event.roomId,
    seq: event.seq,
    type: event.type,
    actorId: event.actorId ?? undefined,
    payload: recordJson(event.payload),
    createdAt: dateString(event.createdAt),
  };
}

function toView(room: RoomWithRelations): RoomView {
  return {
    room: toRoom(room),
    participants: room.participants.map(toParticipant),
    agents: room.participants.map((participant) => participant.agent).filter(Boolean).map((agent) => toAgent(agent as DbAgent)),
    messages: room.messages.map(toMessage),
    events: room.events.map(toEvent),
  };
}

async function roomView(roomId: string) {
  const prisma = getPrisma();
  if (!prisma) return undefined;

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      participants: { include: { agent: true }, orderBy: { createdAt: "asc" } },
      messages: { orderBy: { seq: "asc" } },
      events: { orderBy: { seq: "asc" } },
    },
  });

  return room ? toView(room as RoomWithRelations) : undefined;
}

async function addEvent(
  tx: Prisma.TransactionClient,
  roomId: string,
  type: string,
  payload: Record<string, unknown>,
  actorId?: string,
) {
  const room = await tx.room.update({
    where: { id: roomId },
    data: { eventSeq: { increment: 1 } },
    select: { eventSeq: true },
  });

  return tx.roomEvent.create({
    data: {
      id: id("event"),
      roomId,
      seq: room.eventSeq,
      type,
      actorId,
      payload: payload as Prisma.InputJsonObject,
    },
  });
}

async function nextMessageSeq(tx: Prisma.TransactionClient, roomId: string) {
  const room = await tx.room.update({
    where: { id: roomId },
    data: { messageSeq: { increment: 1 } },
    select: { messageSeq: true },
  });

  return room.messageSeq;
}

export async function listRooms() {
  const prisma = getPrisma();
  if (!prisma) return [];

  const rooms = await prisma.room.findMany({ orderBy: { createdAt: "desc" } });
  return rooms.map(toRoom);
}

export async function getRoom(roomId: string) {
  return roomView(roomId);
}

export async function createRoom(input: { title: string; ownerName?: string; mode?: "discussion" | "werewolf" }) {
  const prisma = getPrisma();
  if (!prisma) return undefined;

  const createdAt = now();
  const roomId = id("room");
  const hostId = id("participant");
  const title = cleanText(input.title, ROOM_LIMITS.title) || "未命名讨论室";
  const hostName = cleanText(input.ownerName, ROOM_LIMITS.name) || "用户";
  const mode = input.mode === "werewolf" ? "werewolf" : "discussion";

  await prisma.$transaction(async (tx) => {
    await tx.room.create({
      data: {
        id: roomId,
        title,
        mode,
        status: "open",
        ownerId: "local-user",
        createdAt,
        updatedAt: createdAt,
      },
    });
    await tx.participant.create({
      data: {
        id: hostId,
        roomId,
        kind: "human",
        userId: "local-user",
        name: hostName,
        status: "online",
        createdAt,
      },
    });
    await addEvent(tx, roomId, "room.created", { roomId, title }, hostId);
  });

  return roomView(roomId) as Promise<RoomView>;
}

export async function addAgent(
  roomId: string,
  input: { name: string; role: string; persona?: string; goal?: string; provider?: string; model?: string },
) {
  const prisma = getPrisma();
  if (!prisma) return undefined;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return undefined;

  const createdAt = now();
  const agentId = id("agent");
  const participantId = id("participant");
  const provider = normalizeProvider(input.provider ?? getProviderPublicConfig().defaultProvider);
  const model = cleanText(input.model, ROOM_LIMITS.name) || defaultModelForProvider(provider);
  const agent = {
    id: agentId,
    name: cleanText(input.name, ROOM_LIMITS.name),
    role: cleanText(input.role, ROOM_LIMITS.role),
    persona: cleanText(input.persona, ROOM_LIMITS.profile) || "保持清晰、直接、基于角色职责发言。",
    goal: cleanText(input.goal, ROOM_LIMITS.profile) || "帮助房间推进讨论。",
    provider,
    model,
    temperature: 0.4,
    enabled: true,
  };

  await prisma.$transaction(async (tx) => {
    await tx.agent.create({ data: agent });
    await tx.participant.create({
      data: {
        id: participantId,
        roomId,
        kind: "ai",
        agentId,
        name: agent.name,
        status: "offline",
        createdAt,
      },
    });
    await tx.room.update({ where: { id: roomId }, data: { updatedAt: createdAt } });
    await addEvent(tx, roomId, "agent.added", { agentId, name: agent.name, role: agent.role }, participantId);
  });

  return roomView(roomId) as Promise<RoomView>;
}

export async function updateAgent(
  roomId: string,
  agentId: string,
  input: { name?: string; role?: string; persona?: string; goal?: string; provider?: string; model?: string; temperature?: number; enabled?: boolean },
) {
  const prisma = getPrisma();
  if (!prisma) return undefined;

  const existing = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!existing) return undefined;

  const nextProvider = input.provider !== undefined ? normalizeProvider(input.provider) : (existing.provider as Agent["provider"]);
  const nextName = input.name !== undefined ? cleanText(input.name, ROOM_LIMITS.name) || existing.name : existing.name;
  const data: Partial<DbAgent> = {
    name: nextName,
    role: input.role !== undefined ? cleanText(input.role, ROOM_LIMITS.role) || existing.role : existing.role,
    persona: input.persona !== undefined ? cleanText(input.persona, ROOM_LIMITS.profile) || existing.persona : existing.persona,
    goal: input.goal !== undefined ? cleanText(input.goal, ROOM_LIMITS.profile) || existing.goal : existing.goal,
    provider: nextProvider,
    model: input.model !== undefined ? cleanText(input.model, ROOM_LIMITS.name) || defaultModelForProvider(nextProvider) : existing.model,
    temperature: typeof input.temperature === "number" ? Math.min(1, Math.max(0, input.temperature)) : existing.temperature,
    enabled: typeof input.enabled === "boolean" ? input.enabled : existing.enabled,
  };

  const updatedAt = now();
  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data });
    if (data.name && data.name !== existing.name) {
      await tx.participant.updateMany({ where: { roomId, agentId }, data: { name: data.name } });
    }
    await tx.room.update({ where: { id: roomId }, data: { updatedAt } });
    await addEvent(tx, roomId, "agent.updated", { agentId, name: data.name, role: data.role });
  });

  return roomView(roomId) as Promise<RoomView>;
}

export async function addMessage(roomId: string, input: { content: string; senderId?: string }) {
  const prisma = getPrisma();
  if (!prisma) return undefined;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return undefined;

  const content = cleanText(input.content, ROOM_LIMITS.message);
  if (!content) return undefined;

  const createdAt = now();
  const senderId = input.senderId || "local-user";

  await prisma.$transaction(async (tx) => {
    const seq = await nextMessageSeq(tx, roomId);
    const messageId = id("message");
    await tx.message.create({
      data: {
        id: messageId,
        roomId,
        senderKind: "human",
        senderId,
        type: "text",
        content,
        status: "completed",
        seq,
        metadata: {},
        createdAt,
      },
    });
    await tx.room.update({ where: { id: roomId }, data: { updatedAt: createdAt } });
    await addEvent(tx, roomId, "message.created", { messageId, content }, senderId);
  });

  return roomView(roomId) as Promise<RoomView>;
}

export async function startDiscussion(roomId: string) {
  const prisma = getPrisma();
  if (!prisma) return undefined;

  const current = await roomView(roomId);
  if (!current) return undefined;

  const aiParticipants = current.participants.filter((participant) => participant.kind === "ai" && participant.agentId);
  const round = current.events.filter((event) => event.type === "discussion.started").length + 1;
  const startedAt = now();
  const nextMessages = [...current.messages];

  await prisma.$transaction(async (tx) => {
    await tx.room.update({ where: { id: roomId }, data: { status: "running", updatedAt: startedAt } });
    await addEvent(tx, roomId, "discussion.started", { round, strategy: "roundRobin", agentCount: aiParticipants.length });
  });

  for (const participant of aiParticipants) {
    const agent = current.agents.find((item) => item.id === participant.agentId);
    if (!agent || !agent.enabled) continue;

    await prisma.$transaction(async (tx) => {
      await tx.participant.update({ where: { id: participant.id }, data: { status: "thinking" } });
      await addEvent(tx, roomId, "agent.thinking", { agentId: agent.id, name: agent.name, round }, participant.id);
      await tx.participant.update({ where: { id: participant.id }, data: { status: "speaking" } });
      await addEvent(tx, roomId, "agent.speaking", { agentId: agent.id, name: agent.name, round }, participant.id);
    });

    const result = await generateAgentReply(agent, nextMessages, round);
    const createdAt = now();

    await prisma.$transaction(async (tx) => {
      const seq = await nextMessageSeq(tx, roomId);
      const messageId = id("message");
      const message: Message = {
        id: messageId,
        roomId,
        senderKind: "ai",
        senderId: participant.id,
        type: "text",
        content: result.text,
        status: result.status,
        seq,
        metadata: providerMetadata(result, { agentId: agent.id, round }),
        createdAt,
      };

      nextMessages.push(message);
      await tx.message.create({ data: { ...message, metadata: message.metadata as Prisma.InputJsonObject } });
      await addEvent(tx, roomId, "message.created", { messageId, agentId: agent.id, round, provider: result.provider }, participant.id);
      await tx.participant.update({ where: { id: participant.id }, data: { status: result.status === "completed" ? "completed" : "failed" } });
      await addEvent(
        tx,
        roomId,
        result.status === "completed" ? "agent.completed" : "agent.failed",
        { agentId: agent.id, name: agent.name, round, provider: result.provider, error: result.error },
        participant.id,
      );
    });
  }

  const completedAt = now();
  await prisma.$transaction(async (tx) => {
    await tx.room.update({ where: { id: roomId }, data: { status: "open", updatedAt: completedAt } });
    await addEvent(tx, roomId, "discussion.completed", { round, messageCount: nextMessages.length });
  });

  return roomView(roomId) as Promise<RoomView>;
}