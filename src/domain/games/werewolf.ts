import type {
  ActionInput,
  GameContext,
  GameParticipantInfo,
  GamePlayerState,
  GameSession,
  GameSystemEvent,
} from "../game-types";
import type { GameDefinition, GameHelpers, GameValidationError } from "./registry";

const ROLE = {
  werewolf: "werewolf",
  seer: "seer",
  villager: "villager",
} as const;

type WerewolfRole = (typeof ROLE)[keyof typeof ROLE];

const PHASE = {
  lobby: "lobby",
  night_werewolf: "night_werewolf",
  night_seer: "night_seer",
  day_announce: "day_announce",
  day_discuss: "day_discuss",
  day_vote: "day_vote",
  ended: "ended",
} as const;

type WerewolfPhase = (typeof PHASE)[keyof typeof PHASE];

const phaseLabels: Record<WerewolfPhase, string> = {
  lobby: "等待开始",
  night_werewolf: "夜晚 · 狼人行动",
  night_seer: "夜晚 · 预言家行动",
  day_announce: "白天 · 公布",
  day_discuss: "白天 · 自由讨论",
  day_vote: "白天 · 投票",
  ended: "游戏结束",
};

const roleLabels: Record<WerewolfRole, string> = {
  werewolf: "狼人",
  seer: "预言家",
  villager: "村民",
};

type WerewolfStateExtras = {
  round: number;
  alignment?: Record<string, string>;
  pendingKillTargetId?: string;
  lastEliminated?: { participantId: string; reason: "night_kill" | "vote_out" } | null;
  winner?: "werewolf" | "village" | null;
  discussOrder?: string[];
  discussCursor?: number;
};

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function rolesFor(playerCount: number): WerewolfRole[] {
  const wolves = playerCount >= 7 ? 2 : 1;
  const seers = 1;
  const villagers = Math.max(2, playerCount - wolves - seers);
  return [
    ...Array<WerewolfRole>(wolves).fill(ROLE.werewolf),
    ...Array<WerewolfRole>(seers).fill(ROLE.seer),
    ...Array<WerewolfRole>(villagers).fill(ROLE.villager),
  ];
}

function findPlayer(session: GameSession, participantId: string): GamePlayerState | undefined {
  return session.players.find((player) => player.participantId === participantId);
}

function alivePlayers(session: GameSession) {
  return session.players.filter((player) => player.alive);
}

function aliveBy(session: GameSession, role: WerewolfRole) {
  return alivePlayers(session).filter((player) => player.role === role);
}

function tally(session: GameSession, voteKey: string) {
  const counts = new Map<string, number>();
  for (const voter of alivePlayers(session)) {
    const vote = voter.privateState[voteKey] as string | undefined;
    if (!vote) continue;
    counts.set(vote, (counts.get(vote) ?? 0) + 1);
  }
  return counts;
}

function pickMax(counts: Map<string, number>) {
  let max = 0;
  let target: string | undefined;
  let tied = false;
  for (const [participantId, count] of counts.entries()) {
    if (count > max) {
      max = count;
      target = participantId;
      tied = false;
    } else if (count === max) {
      tied = true;
    }
  }
  return tied ? undefined : target;
}

function clearVotes(session: GameSession, voteKey: string) {
  for (const player of session.players) {
    delete player.privateState[voteKey];
  }
}

function checkWinner(session: GameSession): "werewolf" | "village" | undefined {
  const wolves = aliveBy(session, ROLE.werewolf).length;
  const villagers = alivePlayers(session).length - wolves;
  if (wolves === 0) return "village";
  if (wolves >= villagers) return "werewolf";
  return undefined;
}

function extras(session: GameSession) {
  return session.state as Record<string, unknown> as WerewolfStateExtras & Record<string, unknown>;
}

function setPhase(session: GameSession, phase: WerewolfPhase, helpers: GameHelpers) {
  session.phase = phase;
  helpers.emitEvent(session, "phase.changed", { phase, label: phaseLabels[phase] });
}

function enterNightWerewolf(session: GameSession, helpers: GameHelpers) {
  const ext = extras(session);
  ext.round = (ext.round ?? 0) + 1;
  for (const player of session.players) {
    delete player.privateState.nightKillVote;
    delete player.privateState.checked;
    delete player.privateState.dayVote;
  }
  ext.pendingKillTargetId = undefined;
  helpers.emitEvent(session, "round.started", { round: ext.round });
  setPhase(session, PHASE.night_werewolf, helpers);
}

function resolveNightKill(session: GameSession, helpers: GameHelpers) {
  const counts = tally(session, "nightKillVote");
  const target = pickMax(counts) ?? helpers.random(aliveBy(session, ROLE.villager).concat(aliveBy(session, ROLE.seer)))?.participantId;
  const ext = extras(session);
  ext.pendingKillTargetId = target ?? undefined;
  clearVotes(session, "nightKillVote");
}

function enterNightSeer(session: GameSession, helpers: GameHelpers) {
  setPhase(session, PHASE.night_seer, helpers);
}

function enterDayAnnounce(session: GameSession, helpers: GameHelpers) {
  const ext = extras(session);
  const targetId = ext.pendingKillTargetId;
  if (targetId) {
    const victim = findPlayer(session, targetId);
    if (victim && victim.alive) {
      victim.alive = false;
      ext.lastEliminated = { participantId: targetId, reason: "night_kill" };
      helpers.emitEvent(session, "night.kill", { participantId: targetId, name: helpers.participantById(targetId)?.name });
    } else {
      helpers.emitEvent(session, "night.peaceful", {});
    }
  } else {
    helpers.emitEvent(session, "night.peaceful", {});
  }
  ext.pendingKillTargetId = undefined;
  setPhase(session, PHASE.day_announce, helpers);
}

function enterDayDiscuss(session: GameSession, helpers: GameHelpers) {
  const ext = extras(session);
  ext.discussOrder = alivePlayers(session).map((player) => player.participantId);
  ext.discussCursor = 0;
  for (const player of session.players) {
    player.publicState.spoken = false;
  }
  setPhase(session, PHASE.day_discuss, helpers);
}

function enterDayVote(session: GameSession, helpers: GameHelpers) {
  for (const player of session.players) {
    delete player.privateState.dayVote;
  }
  setPhase(session, PHASE.day_vote, helpers);
}

function resolveDayVote(session: GameSession, helpers: GameHelpers) {
  const counts = tally(session, "dayVote");
  const target = pickMax(counts);
  const ext = extras(session);
  if (target) {
    const victim = findPlayer(session, target);
    if (victim && victim.alive) {
      victim.alive = false;
      ext.lastEliminated = { participantId: target, reason: "vote_out" };
      helpers.emitEvent(session, "vote.out", {
        participantId: target,
        name: helpers.participantById(target)?.name,
        role: victim.role,
        tally: Object.fromEntries(counts.entries()),
      });
    }
  } else {
    helpers.emitEvent(session, "vote.tied", { tally: Object.fromEntries(counts.entries()) });
  }
  clearVotes(session, "dayVote");
}

function maybeEnd(session: GameSession, helpers: GameHelpers) {
  const winner = checkWinner(session);
  if (!winner) return false;
  extras(session).winner = winner;
  session.status = "closed";
  setPhase(session, PHASE.ended, helpers);
  helpers.emitEvent(session, "game.ended", { winner });
  return true;
}

const werewolf: GameDefinition = {
  type: "werewolf",
  displayName: "狼人杀",
  description: "村民、狼人、预言家三方博弈。狼人夜晚击杀、预言家查验、白天讨论投票。",
  minPlayers: 4,
  maxPlayers: 12,

  init({ participants }) {
    const seats = participants.slice(0, 12);
    const roles = shuffled(rolesFor(seats.length));
    const players: GamePlayerState[] = seats.map((participant: GameParticipantInfo, index: number) => {
      const role = roles[index];
      return {
        participantId: participant.id,
        role,
        alive: true,
        publicState: { ready: false, spoken: false, alignment: undefined },
        privateState: {
          roleLabel: roleLabels[role],
          knownWolves: [] as string[],
        },
      };
    });

    const wolfIds = players.filter((player) => player.role === ROLE.werewolf).map((player) => player.participantId);
    for (const wolf of players.filter((player) => player.role === ROLE.werewolf)) {
      wolf.privateState.knownWolves = wolfIds;
    }

    return {
      phase: PHASE.lobby,
      state: {
        round: 0,
        winner: null,
        pendingKillTargetId: undefined,
        lastEliminated: null,
      } as Record<string, unknown>,
      players,
    };
  },

  validate(session, input): GameValidationError | undefined {
    if (session.status === "closed" || session.phase === PHASE.ended) return "already_ended";

    if (input.type === "advance") return undefined;

    const actor = findPlayer(session, input.actorId);
    if (!actor) return "actor_not_in_game";
    if (input.type !== "ready" && !actor.alive) return "actor_not_alive";

    if (input.type === "ready") {
      if (session.phase !== PHASE.lobby) return "action_not_allowed_in_phase";
      return undefined;
    }

    if (input.type === "kill") {
      if (session.phase !== PHASE.night_werewolf) return "action_not_allowed_in_phase";
      if (actor.role !== ROLE.werewolf) return "role_not_allowed";
      if (!input.targetId) return "target_invalid";
      const target = findPlayer(session, input.targetId);
      if (!target || !target.alive || target.role === ROLE.werewolf) return "target_invalid";
      return undefined;
    }

    if (input.type === "check") {
      if (session.phase !== PHASE.night_seer) return "action_not_allowed_in_phase";
      if (actor.role !== ROLE.seer) return "role_not_allowed";
      if (!input.targetId) return "target_invalid";
      const target = findPlayer(session, input.targetId);
      if (!target || !target.alive || target.participantId === actor.participantId) return "target_invalid";
      return undefined;
    }

    if (input.type === "say") {
      if (session.phase !== PHASE.day_discuss) return "action_not_allowed_in_phase";
      const text = typeof input.payload?.text === "string" ? input.payload.text.trim() : "";
      if (!text) return "text_required";
      return undefined;
    }

    if (input.type === "vote") {
      if (session.phase !== PHASE.day_vote) return "action_not_allowed_in_phase";
      if (!input.targetId) return "target_invalid";
      const target = findPlayer(session, input.targetId);
      if (!target || !target.alive) return "target_invalid";
      return undefined;
    }

    return "action_type_unknown";
  },

  apply(session, input, helpers) {
    if (input.type === "advance") return {};
    const actor = findPlayer(session, input.actorId);
    if (!actor) return {};

    if (input.type === "ready") {
      actor.publicState.ready = true;
      return {};
    }

    if (input.type === "kill") {
      actor.privateState.nightKillVote = input.targetId;
      return {};
    }

    if (input.type === "check") {
      const target = findPlayer(session, input.targetId as string);
      if (target) {
        const result = target.role === ROLE.werewolf ? "werewolf" : "innocent";
        actor.privateState.checked = { targetId: target.participantId, result };
        helpers.emitEvent(session, "seer.checked.private", {
          seerId: actor.participantId,
          targetId: target.participantId,
          result,
        });
      }
      return {};
    }

    if (input.type === "say") {
      const text = (input.payload?.text as string).trim();
      actor.publicState.spoken = true;
      actor.publicState.lastSay = text;
      helpers.emitEvent(session, "player.said", {
        participantId: actor.participantId,
        name: helpers.participantById(actor.participantId)?.name,
        text,
      });
      return {};
    }

    if (input.type === "vote") {
      actor.privateState.dayVote = input.targetId;
      helpers.emitEvent(session, "player.voted", {
        participantId: actor.participantId,
        name: helpers.participantById(actor.participantId)?.name,
      });
      return {};
    }

    return {};
  },

  autoStep(session, helpers) {
    if (session.status === "closed") return { advanced: false };

    if (session.phase === PHASE.lobby) {
      const allReady = session.players.length > 0 && session.players.every((player: GamePlayerState) => player.publicState.ready === true);
      if (!allReady) return { advanced: false };
      enterNightWerewolf(session, helpers);
      return { advanced: true, note: "lobby_to_night_werewolf" };
    }

    if (session.phase === PHASE.night_werewolf) {
      const wolves = aliveBy(session, ROLE.werewolf);
      const allVoted = wolves.length > 0 && wolves.every((wolf) => typeof wolf.privateState.nightKillVote === "string");
      if (!allVoted) return { advanced: false };
      resolveNightKill(session, helpers);
      const seers = aliveBy(session, ROLE.seer);
      if (seers.length > 0) {
        enterNightSeer(session, helpers);
      } else {
        enterDayAnnounce(session, helpers);
      }
      return { advanced: true, note: "night_werewolf_done" };
    }

    if (session.phase === PHASE.night_seer) {
      const seers = aliveBy(session, ROLE.seer);
      const allChecked = seers.length > 0 && seers.every((seer) => typeof seer.privateState.checked === "object");
      if (!allChecked) return { advanced: false };
      enterDayAnnounce(session, helpers);
      return { advanced: true, note: "night_seer_done" };
    }

    if (session.phase === PHASE.day_announce) {
      if (maybeEnd(session, helpers)) return { advanced: true, note: "ended_after_night" };
      enterDayDiscuss(session, helpers);
      return { advanced: true, note: "announce_to_discuss" };
    }

    if (session.phase === PHASE.day_discuss) {
      const allSpoken = alivePlayers(session).every((player) => player.publicState.spoken === true);
      if (!allSpoken) return { advanced: false };
      enterDayVote(session, helpers);
      return { advanced: true, note: "discuss_to_vote" };
    }

    if (session.phase === PHASE.day_vote) {
      const voters = alivePlayers(session);
      const allVoted = voters.length > 0 && voters.every((voter) => typeof voter.privateState.dayVote === "string");
      if (!allVoted) return { advanced: false };
      resolveDayVote(session, helpers);
      if (maybeEnd(session, helpers)) return { advanced: true, note: "ended_after_vote" };
      enterNightWerewolf(session, helpers);
      return { advanced: true, note: "vote_to_night" };
    }

    return { advanced: false };
  },

  sanitize(session, viewerId) {
    const viewerPlayer = viewerId ? findPlayer(session, viewerId) : undefined;
    const isWolfViewer = viewerPlayer?.role === ROLE.werewolf;

    const players = session.players.map((player: GamePlayerState) => {
      const isSelf = viewerId && player.participantId === viewerId;
      const visiblePrivate: Record<string, unknown> = {};

      if (isSelf) {
        Object.assign(visiblePrivate, player.privateState);
      } else if (isWolfViewer && player.role === ROLE.werewolf) {
        visiblePrivate.roleLabel = roleLabels[player.role as WerewolfRole];
      }

      const publicState = { ...player.publicState };

      const showRoleToViewer =
        isSelf ||
        (isWolfViewer && player.role === ROLE.werewolf) ||
        session.phase === PHASE.ended ||
        !player.alive;

      return {
        ...player,
        role: showRoleToViewer ? player.role : "hidden",
        publicState,
        privateState: visiblePrivate,
      };
    });

    const events = session.events.filter((event: GameSystemEvent) => {
      if (!event.type.endsWith(".private")) return true;
      if (event.type === "seer.checked.private") {
        return event.payload.seerId === viewerId;
      }
      return false;
    });

    return {
      ...session,
      players,
      events,
    };
  },
};

export const werewolfDefinition = werewolf;
export const werewolfPhaseLabels = phaseLabels;
export const werewolfRoleLabels = roleLabels;
export type { WerewolfPhase, WerewolfRole };