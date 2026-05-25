import { getRoom } from "../room-store";
import type { Agent } from "../types";
import type { ActionInput, GameParticipantInfo, GameSession } from "../game-types";
import {
  autoStepOnce,
  createSession,
  getActiveSessionByRoom,
  getSession,
  sanitizeForViewer,
  submitAction,
  syncParticipants,
} from "../game-store";
import { emitGameUpdated } from "../../realtime/events";
import { nextAIAction } from "./ai-driver";

const MAX_AI_TURNS = 64;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayForAction(type: string) {
  switch (type) {
    case "say":
      return 2200;
    case "vote":
    case "kill":
    case "check":
      return 1400;
    case "ready":
      return 300;
    default:
      return 800;
  }
}

function delayForPhase(note: string | undefined) {
  if (!note) return 600;
  if (note.startsWith("ended")) return 0;
  if (note === "announce_to_discuss") return 1800;
  if (note === "lobby_to_night_werewolf") return 1200;
  if (note === "night_werewolf_done") return 1500;
  if (note === "night_seer_done") return 1200;
  if (note === "discuss_to_vote") return 1500;
  if (note === "vote_to_night") return 1800;
  return 800;
}

async function collectAgents(roomId: string): Promise<{ participants: GameParticipantInfo[]; agents: Map<string, Agent> }> {
  const room = await getRoom(roomId);
  if (!room) return { participants: [], agents: new Map() };

  const participants: GameParticipantInfo[] = room.participants.map((participant) => ({
    id: participant.id,
    kind: participant.kind,
    agentId: participant.agentId,
    name: participant.name,
  }));

  const agents = new Map<string, Agent>();
  for (const participant of room.participants) {
    if (participant.kind !== "ai" || !participant.agentId) continue;
    const agent = room.agents.find((entry) => entry.id === participant.agentId);
    if (agent) agents.set(participant.id, agent);
  }

  syncParticipants(roomId, participants);
  return { participants, agents };
}

async function runAILoop(sessionId: string, participants: GameParticipantInfo[], agents: Map<string, Agent>) {
  for (let i = 0; i < MAX_AI_TURNS; i += 1) {
    const current = getSession(sessionId);
    if (!current) break;
    if (current.status === "closed") break;

    const next = await nextAIAction({ session: current, participants, agents });
    if (next) {
      const result = submitAction(sessionId, next);
      if (result.error) break;
      if (result.session) emitGameUpdated(result.session);
      await sleep(delayForAction(next.type));
      continue;
    }

    const step = autoStepOnce(sessionId);
    if (!step.advanced) break;
    if (step.session) emitGameUpdated(step.session);
    await sleep(delayForPhase(step.note));
  }
}

function startAILoop(sessionId: string, participants: GameParticipantInfo[], agents: Map<string, Agent>) {
  void runAILoop(sessionId, participants, agents).catch((error) => {
    console.error("[game] AI loop error", error);
  });
}

export async function createGameForRoom(input: { roomId: string; gameType: string; payload?: Record<string, unknown> }) {
  const { participants, agents } = await collectAgents(input.roomId);
  if (participants.length < 4) {
    console.warn("[game] not_enough_participants", { roomId: input.roomId, count: participants.length });
    return { error: "not_enough_participants" as const };
  }

  const created = createSession({
    roomId: input.roomId,
    gameType: input.gameType,
    participants,
    payload: input.payload,
  });

  if (typeof created === "string") {
    console.warn("[game] createSession failed", { roomId: input.roomId, gameType: input.gameType, reason: created });
    return { error: created };
  }

  startAILoop(created.id, participants, agents);
  const session = getSession(created.id);
  return { session };
}

export async function submitGameAction(
  roomId: string,
  sessionId: string,
  input: ActionInput,
): Promise<{ session?: GameSession; error?: string }> {
  const { participants, agents } = await collectAgents(roomId);
  const result = submitAction(sessionId, input);
  if (result.error) return { error: result.error };

  startAILoop(sessionId, participants, agents);
  const session = getSession(sessionId);
  return { session };
}

export async function autoStepGame(roomId: string, sessionId: string) {
  const { participants, agents } = await collectAgents(roomId);
  startAILoop(sessionId, participants, agents);
  return getSession(sessionId);
}

export function activeSession(roomId: string) {
  return getActiveSessionByRoom(roomId);
}

export function viewerSession(sessionId: string, viewerId?: string) {
  const session = getSession(sessionId);
  return session ? sanitizeForViewer(session, viewerId) : undefined;
}

export { sanitizeForViewer };