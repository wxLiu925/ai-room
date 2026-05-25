export type AgentProvider = "mock" | "openai" | "deepseek" | "gemini" | "grok" | "qwen";
export type RoomMode = "discussion" | "werewolf";
export type RoomStatus = "open" | "running" | "archived";
export type ParticipantKind = "human" | "ai";
export type ParticipantStatus = "online" | "offline" | "thinking" | "speaking" | "completed" | "failed";
export type SenderKind = "human" | "ai" | "system";
export type MessageType = "text" | "event" | "vote" | "action";
export type MessageStatus = "pending" | "streaming" | "completed" | "failed";

export type Room = {
  id: string;
  title: string;
  mode: RoomMode;
  status: RoomStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

export type Agent = {
  id: string;
  name: string;
  role: string;
  persona: string;
  goal: string;
  provider: AgentProvider;
  model: string;
  temperature: number;
  enabled: boolean;
};

export type Participant = {
  id: string;
  roomId: string;
  kind: ParticipantKind;
  userId?: string;
  agentId?: string;
  name: string;
  status: ParticipantStatus;
  createdAt: string;
};

export type Message = {
  id: string;
  roomId: string;
  senderKind: SenderKind;
  senderId?: string;
  type: MessageType;
  content: string;
  status: MessageStatus;
  seq: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type RoomEvent = {
  id: string;
  roomId: string;
  seq: number;
  type: string;
  actorId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type RoomView = {
  room: Room;
  participants: Participant[];
  agents: Agent[];
  messages: Message[];
  events: RoomEvent[];
};