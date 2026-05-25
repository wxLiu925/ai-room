import type {
  ActionInput,
  GameContext,
  GameParticipantInfo,
  GameSession,
} from "../game-types";

export type GameValidationError = string;

export type SubmitOutcome = {
  session: GameSession;
  appliedActionId?: string;
  note?: string;
};

export type GameDefinition = {
  type: string;
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;

  init(context: GameContext): Pick<GameSession, "phase" | "state" | "players">;

  validate(session: GameSession, input: ActionInput): GameValidationError | undefined;

  apply(
    session: GameSession,
    input: ActionInput,
    helpers: GameHelpers,
  ): { note?: string };

  autoStep(session: GameSession, helpers: GameHelpers): { advanced: boolean; note?: string };

  sanitize(session: GameSession, viewerId?: string): GameSession;
};

export type GameHelpers = {
  now(): string;
  id(prefix: string): string;
  emitEvent(session: GameSession, type: string, payload: Record<string, unknown>): void;
  participantById(id: string): GameParticipantInfo | undefined;
  random<T>(items: T[]): T | undefined;
};

const registry = new Map<string, GameDefinition>();

export function registerGame(definition: GameDefinition) {
  registry.set(definition.type, definition);
}

export function getGameDefinition(type: string): GameDefinition | undefined {
  return registry.get(type);
}

export function listGameDefinitions(): GameDefinition[] {
  return Array.from(registry.values());
}