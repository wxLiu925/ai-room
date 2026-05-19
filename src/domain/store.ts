import { mockReply } from "./mock-provider";
import type { Agent, Message, Participant, ParticipantStatus, Room, RoomEvent, RoomView } from "./types";

type State = {
  rooms: Map<string, Room>;
  agents: Map<string, Agent>;
  participants: Map<string, Participant[]>;
  messages: Map<string, Message[]>;
  events: Map<string, RoomEvent[]>;
  seq: Map<string, number>;
};

type StoreGlobal = typeof globalThis & {
  aiRoomStore?: State;
};

const globalStore = globalThis as StoreGlobal;

const state = globalStore.aiRoomStore ?? {
  rooms: new Map<string, Room>(),
  agents: new Map<string, Agent>(),
  participants: new Map<string, Participant[]>(),
  messages: new Map<string, Message[]>(),
  events: new Map<string, RoomEvent[]>(),
  seq: new Map<string, number>(),
};

globalStore.aiRoomStore = state;

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nextSeq(roomId: string) {
  const seq = (state.seq.get(roomId) ?? 0) + 1;
  state.seq.set(roomId, seq);
  return seq;
}

function event(roomId: string, type: string, payload: Record<string, unknown>, actorId?: string) {
  const item: RoomEvent = {
    id: id("event"),
    roomId,
    seq: nextSeq(roomId),
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

  return {
    room,
    participants,
    agents: agentIds.map((agentId) => state.agents.get(agentId)).filter(Boolean) as Agent[],
    messages: state.messages.get(roomId) ?? [],
    events: state.events.get(roomId) ?? [],
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
  return Array.from(state.rooms.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRoom(roomId: string) {
  return view(roomId);
}

export function createRoom(input: { title: string; ownerName?: string }) {
  const createdAt = now();
  const room: Room = {
    id: id("room"),
    title: input.title.trim(),
    mode: "discussion",
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
    name: input.ownerName?.trim() || "用户",
    status: "online",
    createdAt,
  };

  state.rooms.set(room.id, room);
  state.participants.set(room.id, [host]);
  state.messages.set(room.id, []);
  state.events.set(room.id, []);
  state.seq.set(room.id, 0);
  event(room.id, "room.created", { roomId: room.id, title: room.title }, host.id);

  return view(room.id) as RoomView;
}

export function addAgent(roomId: string, input: { name: string; role: string; persona?: string; goal?: string }) {
  const room = state.rooms.get(roomId);
  if (!room) return undefined;

  const createdAt = now();
  const agent: Agent = {
    id: id("agent"),
    name: input.name.trim(),
    role: input.role.trim(),
    persona: input.persona?.trim() || "保持清晰、直接、基于角色职责发言。",
    goal: input.goal?.trim() || "帮助房间推进讨论。",
    provider: "mock",
    model: "mock-v1",
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

export function addMessage(roomId: string, input: { content: string; senderId?: string }) {
  const room = state.rooms.get(roomId);
  if (!room) return undefined;

  const createdAt = now();
  const message: Message = {
    id: id("message"),
    roomId,
    senderKind: "human",
    senderId: input.senderId || "local-user",
    type: "text",
    content: input.content.trim(),
    status: "completed",
    seq: nextSeq(roomId),
    metadata: {},
    createdAt,
  };

  state.messages.set(roomId, [...(state.messages.get(roomId) ?? []), message]);
  state.rooms.set(roomId, { ...room, updatedAt: createdAt });
  event(roomId, "message.created", { messageId: message.id, content: message.content }, message.senderId);

  return view(roomId) as RoomView;
}

export function startDiscussion(roomId: string) {
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

    const createdAt = now();
    const message: Message = {
      id: id("message"),
      roomId,
      senderKind: "ai",
      senderId: participant.id,
      type: "text",
      content: mockReply(agent, nextMessages, round),
      status: "completed",
      seq: nextSeq(roomId),
      metadata: { agentId: agent.id, round },
      createdAt,
    };

    nextMessages.push(message);
    event(roomId, "message.created", { messageId: message.id, agentId: agent.id, round }, participant.id);
    updateParticipant(roomId, participant.id, "completed");
    event(roomId, "agent.completed", { agentId: agent.id, name: agent.name, round }, participant.id);
  }

  state.messages.set(roomId, nextMessages);
  const completedAt = now();
  state.rooms.set(roomId, { ...(state.rooms.get(roomId) as Room), status: "open", updatedAt: completedAt });
  event(roomId, "discussion.completed", { round, messageCount: nextMessages.length });

  return view(roomId) as RoomView;
}