export type GameStatus = "active" | "closed";

export type GamePlayerState = {
  participantId: string;
  role: string;
  alive: boolean;
  publicState: Record<string, unknown>;
  privateState: Record<string, unknown>;
};

export type GameAction = {
  id: string;
  gameSessionId: string;
  actorId: string;
  type: string;
  targetId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type GameSession = {
  id: string;
  roomId: string;
  gameType: string;
  phase: string;
  status: GameStatus;
  state: Record<string, unknown>;
  players: GamePlayerState[];
  actions: GameAction[];
  events: GameSystemEvent[];
  createdAt: string;
  updatedAt: string;
};

export type GameSystemEvent = {
  id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type GameView = {
  session: GameSession;
  viewerId?: string;
};

export type ActionInput = {
  type: string;
  actorId: string;
  targetId?: string;
  payload?: Record<string, unknown>;
};

export type GameParticipantInfo = {
  id: string;
  kind: "human" | "ai";
  agentId?: string;
  name: string;
};

export type GameContext = {
  participants: GameParticipantInfo[];
  payload: Record<string, unknown>;
};