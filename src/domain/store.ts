import { defaultModelForProvider, generateAgentReply, getProviderPublicConfig, normalizeProvider, providerMetadata } from "./provider";
import type { Agent, Message, Participant, ParticipantStatus, Room, RoomEvent, RoomMode, RoomView } from "./types";

export const ROOM_LIMITS = {
  title: 80,
  name: 40,
  role: 40,
  profile: 400,
  message: 2000,
} as const;

type State = {
  rooms: Map<string, Room>;
  agents: Map<string, Agent>;
  participants: Map<string, Participant[]>;
  messages: Map<string, Message[]>;
  events: Map<string, RoomEvent[]>;
  eventSeq: Map<string, number>;
  messageSeq: Map<string, number>;
};

type LegacyState = Omit<State, "eventSeq" | "messageSeq"> & {
  seq?: Map<string, number>;
  eventSeq?: Map<string, number>;
  messageSeq?: Map<string, number>;
};

type StoreGlobal = typeof globalThis & {
  aiRoomStore?: LegacyState;
};

const globalStore = globalThis as StoreGlobal;
const existingState = globalStore.aiRoomStore;
const existingMessages = existingState?.messages ?? new Map<string, Message[]>();
const existingEvents = existingState?.events ?? new Map<string, RoomEvent[]>();
const existingEventSeq = new Map(
  Array.from(existingEvents.entries()).map(([roomId, events]) => [roomId, Math.max(0, ...events.map((event) => event.seq))]),
);

const state: State = {
  rooms: existingState?.rooms ?? new Map<string, Room>(),
  agents: existingState?.agents ?? new Map<string, Agent>(),
  participants: existingState?.participants ?? new Map<string, Participant[]>(),
  messages: existingMessages,
  events: existingEvents,
  eventSeq: existingState?.eventSeq ?? existingEventSeq,
  messageSeq:
    existingState?.messageSeq ??
    new Map(
      Array.from(existingMessages.entries()).map(([roomId, messages]) => [
        roomId,
        Math.max(0, ...messages.map((message) => message.seq)),
      ]),
    ),
};

globalStore.aiRoomStore = state;

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nextEventSeq(roomId: string) {
  const seq = (state.eventSeq.get(roomId) ?? 0) + 1;
  state.eventSeq.set(roomId, seq);
  return seq;
}

function nextMessageSeq(roomId: string) {
  const seq = (state.messageSeq.get(roomId) ?? 0) + 1;
  state.messageSeq.set(roomId, seq);
  return seq;
}

function cleanText(value: string | undefined, maxLength: number) {
  return (value ?? "").trim().slice(0, maxLength);
}

function event(roomId: string, type: string, payload: Record<string, unknown>, actorId?: string) {
  const item: RoomEvent = {
    id: id("event"),
    roomId,
    seq: nextEventSeq(roomId),
    type,
    actorId,
    payload,
    createdAt: now(),
  };
  state.events.set(roomId, [...(state.events.get(roomId) ?? []), item]);
  return item;
}

function view(roomId: string): RoomView | undefined {
  const room = state.rooms.get(roomId);
  if (!room) return undefined;

  const participants = state.participants.get(roomId) ?? [];
  const agentIds = participants.map((participant) => participant.agentId).filter(Boolean) as string[];
  const agents = agentIds.map((agentId) => state.agents.get(agentId)).filter(Boolean) as Agent[];
  const messages = state.messages.get(roomId) ?? [];
  const events = state.events.get(roomId) ?? [];

  return {
    room: { ...room },
    participants: participants.map((participant) => ({ ...participant })),
    agents: agents.map((agent) => ({ ...agent })),
    messages: messages.map((message) => ({ ...message, metadata: { ...message.metadata } })),
    events: events.map((item) => ({ ...item, payload: { ...item.payload } })),
  };
}

function updateParticipant(roomId: string, participantId: string, status: ParticipantStatus) {
  const participants = state.participants.get(roomId) ?? [];
  state.participants.set(
    roomId,
    participants.map((participant) => (participant.id === participantId ? { ...participant, status } : participant)),
  );
}

export function listRooms() {
  return Array.from(state.rooms.values())
    .map((room) => ({ ...room }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRoom(roomId: string) {
  return view(roomId);
}

export function createRoom(input: { title: string; ownerName?: string; mode?: RoomMode }) {
  const createdAt = now();
  const room: Room = {
    id: id("room"),
    title: cleanText(input.title, ROOM_LIMITS.title) || "未命名讨论室",
    mode: input.mode === "werewolf" ? "werewolf" : "discussion",
    status: "open",
    ownerId: "local-user",
    createdAt,
    updatedAt: createdAt,
  };

  const host: Participant = {
    id: id("participant"),
    roomId: room.id,
    kind: "human",
    userId: room.ownerId,
    name: cleanText(input.ownerName, ROOM_LIMITS.name) || "用户",
    status: "online",
    createdAt,
  };

  state.rooms.set(room.id, room);
  state.participants.set(room.id, [host]);
  state.messages.set(room.id, []);
  state.events.set(room.id, []);
  state.eventSeq.set(room.id, 0);
  state.messageSeq.set(room.id, 0);
  event(room.id, "room.created", { roomId: room.id, title: room.title }, host.id);

  return view(room.id) as RoomView;
}

export function addAgent(
  roomId: string,
  input: { name: string; role: string; persona?: string; goal?: string; provider?: string; model?: string },
) {
  const room = state.rooms.get(roomId);
  if (!room) return undefined;

  const createdAt = now();
  const provider = normalizeProvider(input.provider ?? getProviderPublicConfig().defaultProvider);
  const model = cleanText(input.model, ROOM_LIMITS.name) || defaultModelForProvider(provider);
  const agent: Agent = {
    id: id("agent"),
    name: cleanText(input.name, ROOM_LIMITS.name),
    role: cleanText(input.role, ROOM_LIMITS.role),
    persona: cleanText(input.persona, ROOM_LIMITS.profile) || "保持清晰、直接、基于角色职责发言。",
    goal: cleanText(input.goal, ROOM_LIMITS.profile) || "帮助房间推进讨论。",
    provider,
    model,
    temperature: 0.4,
    enabled: true,
  };
  const participant: Participant = {
    id: id("participant"),
    roomId,
    kind: "ai",
    agentId: agent.id,
    name: agent.name,
    status: "offline",
    createdAt,
  };

  state.agents.set(agent.id, agent);
  state.participants.set(roomId, [...(state.participants.get(roomId) ?? []), participant]);
  state.rooms.set(roomId, { ...room, updatedAt: createdAt });
  event(roomId, "agent.added", { agentId: agent.id, name: agent.name, role: agent.role }, participant.id);

  return view(roomId) as RoomView;
}

export function updateAgent(
  roomId: string,
  agentId: string,
  input: { name?: string; role?: string; persona?: string; goal?: string; provider?: string; model?: string; temperature?: number; enabled?: boolean },
) {
  const room = state.rooms.get(roomId);
  if (!room) return undefined;

  const agent = state.agents.get(agentId);
  if (!agent) return undefined;

  const nextProvider = input.provider !== undefined ? normalizeProvider(input.provider) : agent.provider;
  const nextName = input.name !== undefined ? cleanText(input.name, ROOM_LIMITS.name) || agent.name : agent.name;
  const next: Agent = {
    ...agent,
    name: nextName,
    role: input.role !== undefined ? cleanText(input.role, ROOM_LIMITS.role) || agent.role : agent.role,
    persona: input.persona !== undefined ? cleanText(input.persona, ROOM_LIMITS.profile) || agent.persona : agent.persona,
    goal: input.goal !== undefined ? cleanText(input.goal, ROOM_LIMITS.profile) || agent.goal : agent.goal,
    provider: nextProvider,
    model: input.model !== undefined ? cleanText(input.model, ROOM_LIMITS.name) || defaultModelForProvider(nextProvider) : agent.model,
    temperature: typeof input.temperature === "number" ? Math.min(1, Math.max(0, input.temperature)) : agent.temperature,
    enabled: typeof input.enabled === "boolean" ? input.enabled : agent.enabled,
  };

  state.agents.set(agentId, next);

  const participants = state.participants.get(roomId) ?? [];
  if (nextName !== agent.name) {
    state.participants.set(
      roomId,
      participants.map((participant) =>
        participant.agentId === agentId ? { ...participant, name: nextName } : participant,
      ),
    );
  }

  const updatedAt = now();
  state.rooms.set(roomId, { ...room, updatedAt });
  event(roomId, "agent.updated", { agentId, name: next.name, role: next.role });

  return view(roomId) as RoomView;
}

export function addMessage(roomId: string, input: { content: string; senderId?: string }) {
  const room = state.rooms.get(roomId);
  if (!room) return undefined;

  const content = cleanText(input.content, ROOM_LIMITS.message);
  if (!content) return undefined;

  const createdAt = now();
  const message: Message = {
    id: id("message"),
    roomId,
    senderKind: "human",
    senderId: input.senderId || "local-user",
    type: "text",
    content,
    status: "completed",
    seq: nextMessageSeq(roomId),
    metadata: {},
    createdAt,
  };

  state.messages.set(roomId, [...(state.messages.get(roomId) ?? []), message]);
  state.rooms.set(roomId, { ...room, updatedAt: createdAt });
  event(roomId, "message.created", { messageId: message.id, content: message.content }, message.senderId);

  return view(roomId) as RoomView;
}

export async function startDiscussion(roomId: string) {
  const room = state.rooms.get(roomId);
  if (!room) return undefined;

  const participants = state.participants.get(roomId) ?? [];
  const aiParticipants = participants.filter((participant) => participant.kind === "ai" && participant.agentId);
  const messages = state.messages.get(roomId) ?? [];
  const round = (state.events.get(roomId) ?? []).filter((item) => item.type === "discussion.started").length + 1;
  const startedAt = now();

  state.rooms.set(roomId, { ...room, status: "running", updatedAt: startedAt });
  event(roomId, "discussion.started", { round, strategy: "roundRobin", agentCount: aiParticipants.length });

  const nextMessages = [...messages];

  for (const participant of aiParticipants) {
    const agent = state.agents.get(participant.agentId as string);
    if (!agent || !agent.enabled) continue;

    updateParticipant(roomId, participant.id, "thinking");
    event(roomId, "agent.thinking", { agentId: agent.id, name: agent.name, round }, participant.id);

    updateParticipant(roomId, participant.id, "speaking");
    event(roomId, "agent.speaking", { agentId: agent.id, name: agent.name, round }, participant.id);

    const result = await generateAgentReply(agent, nextMessages, round);
    const createdAt = now();
    const message: Message = {
      id: id("message"),
      roomId,
      senderKind: "ai",
      senderId: participant.id,
      type: "text",
      content: result.text,
      status: result.status,
      seq: nextMessageSeq(roomId),
      metadata: providerMetadata(result, { agentId: agent.id, round }),
      createdAt,
    };

    nextMessages.push(message);
    event(roomId, "message.created", { messageId: message.id, agentId: agent.id, round, provider: result.provider }, participant.id);
    updateParticipant(roomId, participant.id, result.status === "completed" ? "completed" : "failed");
    event(
      roomId,
      result.status === "completed" ? "agent.completed" : "agent.failed",
      {
        agentId: agent.id,
        name: agent.name,
        round,
        provider: result.provider,
        error: result.error,
      },
      participant.id,
    );
  }

  state.messages.set(roomId, nextMessages);
  const completedAt = now();
  state.rooms.set(roomId, { ...(state.rooms.get(roomId) as Room), status: "open", updatedAt: completedAt });
  event(roomId, "discussion.completed", { round, messageCount: nextMessages.length });

  return view(roomId) as RoomView;
}