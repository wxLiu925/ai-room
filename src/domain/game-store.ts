import type {
  ActionInput,
  GameContext,
  GameParticipantInfo,
  GameSession,
  GameSystemEvent,
} from "./game-types";
import { getGameDefinition } from "./games/registry";
import type { GameHelpers } from "./games/registry";
import "./games/index";

type Store = {
  sessions: Map<string, GameSession>;
  byRoom: Map<string, string[]>;
  participantsByRoom: Map<string, GameParticipantInfo[]>;
  eventSeqBySession: Map<string, number>;
};

type StoreGlobal = typeof globalThis & {
  aiRoomGameStore?: Store;
};

const globalStore = globalThis as StoreGlobal;
globalStore.aiRoomGameStore ??= {
  sessions: new Map(),
  byRoom: new Map(),
  participantsByRoom: new Map(),
  eventSeqBySession: new Map(),
};
const state = globalStore.aiRoomGameStore;

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function helpersFor(roomId: string): GameHelpers {
  const participants = state.participantsByRoom.get(roomId) ?? [];
  return {
    now,
    id,
    emitEvent(session, type, payload) {
      const seq = (state.eventSeqBySession.get(session.id) ?? 0) + 1;
      state.eventSeqBySession.set(session.id, seq);
      const event: GameSystemEvent = {
        id: id("gev"),
        seq,
        type,
        payload,
        createdAt: now(),
      };
      session.events.push(event);
    },
    participantById(pid) {
      return participants.find((participant) => participant.id === pid);
    },
    random<T>(items: T[]) {
      if (items.length === 0) return undefined;
      return items[Math.floor(Math.random() * items.length)];
    },
  };
}

export type CreateSessionInput = {
  roomId: string;
  gameType: string;
  participants: GameParticipantInfo[];
  payload?: Record<string, unknown>;
};

export function createSession(input: CreateSessionInput): GameSession | string {
  const definition = getGameDefinition(input.gameType);
  if (!definition) return "game_type_unknown";
  if (input.participants.length < definition.minPlayers) return "not_enough_players";

  const context: GameContext = {
    participants: input.participants,
    payload: input.payload ?? {},
  };

  const partial = definition.init(context);
  const session: GameSession = {
    id: id("game"),
    roomId: input.roomId,
    gameType: definition.type,
    phase: partial.phase,
    status: "active",
    state: partial.state,
    players: partial.players,
    actions: [],
    events: [],
    createdAt: now(),
    updatedAt: now(),
  };

  state.sessions.set(session.id, session);
  state.participantsByRoom.set(input.roomId, input.participants);
  state.byRoom.set(input.roomId, [...(state.byRoom.get(input.roomId) ?? []), session.id]);
  state.eventSeqBySession.set(session.id, 0);

  const helpers = helpersFor(input.roomId);
  helpers.emitEvent(session, "game.created", {
    gameType: definition.type,
    displayName: definition.displayName,
    playerCount: session.players.length,
  });

  return clone(session);
}

export function getSession(sessionId: string): GameSession | undefined {
  const session = state.sessions.get(sessionId);
  return session ? clone(session) : undefined;
}

export function getActiveSessionByRoom(roomId: string): GameSession | undefined {
  const ids = state.byRoom.get(roomId) ?? [];
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const session = state.sessions.get(ids[i]);
    if (session && session.status === "active") return clone(session);
  }
  const last = ids[ids.length - 1];
  return last ? clone(state.sessions.get(last) as GameSession) : undefined;
}

export function listSessionsByRoom(roomId: string): GameSession[] {
  return (state.byRoom.get(roomId) ?? [])
    .map((sessionId) => state.sessions.get(sessionId))
    .filter(Boolean)
    .map((session) => clone(session as GameSession));
}

export type SubmitResult = {
  session: GameSession;
  appliedActionId?: string;
  note?: string;
  error?: string;
};

export function submitAction(sessionId: string, input: ActionInput): SubmitResult {
  const session = state.sessions.get(sessionId);
  if (!session) return { session: {} as GameSession, error: "session_not_found" };

  const definition = getGameDefinition(session.gameType);
  if (!definition) return { session: clone(session), error: "game_type_unknown" };

  const helpers = helpersFor(session.roomId);

  if (input.type === "advance") {
    const step = definition.autoStep(session, helpers);
    if (step.advanced) session.updatedAt = now();
    return { session: clone(session), note: step.note };
  }

  const error = definition.validate(session, input);
  if (error) return { session: clone(session), error };

  definition.apply(session, input, helpers);
  const action = {
    id: id("action"),
    gameSessionId: session.id,
    actorId: input.actorId,
    type: input.type,
    targetId: input.targetId,
    payload: input.payload ?? {},
    createdAt: now(),
  };
  session.actions.push(action);
  session.updatedAt = now();

  return { session: clone(session), appliedActionId: action.id };
}

export function autoStepOnce(sessionId: string): { session?: GameSession; advanced: boolean; note?: string } {
  const session = state.sessions.get(sessionId);
  if (!session) return { advanced: false };

  const definition = getGameDefinition(session.gameType);
  if (!definition) return { advanced: false, session: clone(session) };

  const helpers = helpersFor(session.roomId);
  const step = definition.autoStep(session, helpers);
  if (step.advanced) session.updatedAt = now();
  return { session: clone(session), advanced: step.advanced, note: step.note };
}

export function sanitizeForViewer(session: GameSession, viewerId?: string): GameSession {
  const definition = getGameDefinition(session.gameType);
  if (!definition) return clone(session);
  return definition.sanitize(clone(session), viewerId);
}

export function syncParticipants(roomId: string, participants: GameParticipantInfo[]) {
  state.participantsByRoom.set(roomId, participants);
}