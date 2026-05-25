import { generateAgentReply } from "../provider";
import type { Agent, Message } from "../types";
import type {
  ActionInput,
  GameParticipantInfo,
  GamePlayerState,
  GameSession,
} from "../game-types";
import { getGameDefinition } from "./registry";

function aliveOthers(session: GameSession, actorId: string) {
  return session.players.filter((player) => player.alive && player.participantId !== actorId);
}

function aliveByRole(session: GameSession, role: string) {
  return session.players.filter((player) => player.alive && player.role === role);
}

function randomPick<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function nameOf(participants: GameParticipantInfo[], participantId: string) {
  return participants.find((participant) => participant.id === participantId)?.name ?? "玩家";
}

function buildSayContext(
  session: GameSession,
  actor: GamePlayerState,
  participants: GameParticipantInfo[],
): Message[] {
  const round = (session.state as { round?: number }).round ?? 1;
  const roleLabel = (actor.privateState.roleLabel as string) ?? actor.role;
  const aliveNames = session.players
    .filter((player) => player.alive)
    .map((player) => nameOf(participants, player.participantId))
    .join("、");

  const recentSays = session.events
    .filter((event) => event.type === "player.said")
    .slice(-8)
    .map((event) => {
      const payload = event.payload as { participantId: string; name: string; text: string };
      return {
        id: event.id,
        roomId: session.roomId,
        senderKind: payload.participantId === actor.participantId ? ("ai" as const) : ("human" as const),
        senderId: payload.participantId,
        type: "text" as const,
        content: `${payload.name}：${payload.text}`,
        status: "completed" as const,
        seq: event.seq,
        metadata: {},
        createdAt: event.createdAt,
      };
    });

  const recentSystem = session.events
    .filter((event) => ["night.kill", "vote.out", "vote.tied", "round.started"].includes(event.type))
    .slice(-4)
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      let summary = event.type;
      if (event.type === "night.kill") summary = `昨夜被害：${payload.name}`;
      if (event.type === "vote.out") summary = `白天放逐：${payload.name}（${payload.role}）`;
      if (event.type === "vote.tied") summary = `白天投票平票`;
      if (event.type === "round.started") summary = `第 ${payload.round} 轮开始`;
      return {
        id: event.id,
        roomId: session.roomId,
        senderKind: "human" as const,
        senderId: undefined,
        type: "text" as const,
        content: `[系统] ${summary}`,
        status: "completed" as const,
        seq: event.seq,
        metadata: {},
        createdAt: event.createdAt,
      };
    });

  const seerInfo = actor.privateState.checked as { targetId: string; result: string } | undefined;
  const knownWolves = (actor.privateState.knownWolves as string[] | undefined) ?? [];

  const briefing: Message = {
    id: "briefing",
    roomId: session.roomId,
    senderKind: "human",
    senderId: undefined,
    type: "text",
    content: [
      `你正在玩狼人杀，当前是第 ${round} 轮白天发言。`,
      `你的真实身份：${roleLabel}。`,
      `存活玩家：${aliveNames}。`,
      knownWolves.length > 1
        ? `你的狼队友：${knownWolves
            .filter((id) => id !== actor.participantId)
            .map((id) => nameOf(participants, id))
            .join("、")}。`
        : "",
      seerInfo ? `你已查验过 ${nameOf(participants, seerInfo.targetId)}，结果是 ${seerInfo.result === "werewolf" ? "狼人" : "好人"}。` : "",
      "请用一两句话发言：分析局势、表达怀疑或为自己辩护。绝不要直接说出自己的身份；狼人要伪装成好人。只输出发言内容，不要前缀。",
    ]
      .filter(Boolean)
      .join("\n"),
    status: "completed",
    seq: 0,
    metadata: {},
    createdAt: new Date().toISOString(),
  };

  return [briefing, ...recentSystem, ...recentSays];
}

async function generateSayText(
  session: GameSession,
  actor: GamePlayerState,
  agent: Agent,
  participants: GameParticipantInfo[],
): Promise<string> {
  const round = (session.state as { round?: number }).round ?? 1;
  const messages = buildSayContext(session, actor, participants);
  try {
    const result = await generateAgentReply(agent, messages, round);
    const text = result.text.trim();
    if (!text) throw new Error("empty");
    return text.length > 400 ? text.slice(0, 400) : text;
  } catch {
    return "我先观察一下，听听其他人怎么说。";
  }
}

export type ScheduleInput = {
  session: GameSession;
  participants: GameParticipantInfo[];
  agents: Map<string, Agent>;
};

export async function nextAIAction(input: ScheduleInput): Promise<ActionInput | undefined> {
  const { session, participants } = input;
  if (session.gameType !== "werewolf") return undefined;

  const aiParticipantIds = new Set(
    participants.filter((participant) => participant.kind === "ai").map((participant) => participant.id),
  );

  if (session.phase === "lobby") {
    const next = session.players.find(
      (player) => aiParticipantIds.has(player.participantId) && player.publicState.ready !== true,
    );
    if (!next) return undefined;
    return { type: "ready", actorId: next.participantId };
  }

  if (session.phase === "night_werewolf") {
    const wolf = aliveByRole(session, "werewolf").find(
      (player) => aiParticipantIds.has(player.participantId) && typeof player.privateState.nightKillVote !== "string",
    );
    if (!wolf) return undefined;
    const candidates = session.players.filter((player) => player.alive && player.role !== "werewolf");
    const target = randomPick(candidates);
    if (!target) return undefined;
    return { type: "kill", actorId: wolf.participantId, targetId: target.participantId };
  }

  if (session.phase === "night_seer") {
    const seer = aliveByRole(session, "seer").find(
      (player) => aiParticipantIds.has(player.participantId) && typeof player.privateState.checked !== "object",
    );
    if (!seer) return undefined;
    const target = randomPick(aliveOthers(session, seer.participantId));
    if (!target) return undefined;
    return { type: "check", actorId: seer.participantId, targetId: target.participantId };
  }

  if (session.phase === "day_discuss") {
    const next = session.players.find(
      (player) => player.alive && aiParticipantIds.has(player.participantId) && player.publicState.spoken !== true,
    );
    if (!next) return undefined;
    const agent = input.agents.get(next.participantId);
    const text = agent ? await generateSayText(session, next, agent, participants) : "我先观察一下。";
    return { type: "say", actorId: next.participantId, payload: { text } };
  }

  if (session.phase === "day_vote") {
    const voter = session.players.find(
      (player) => player.alive && aiParticipantIds.has(player.participantId) && typeof player.privateState.dayVote !== "string",
    );
    if (!voter) return undefined;
    const target = randomPick(aliveOthers(session, voter.participantId));
    if (!target) return undefined;
    return { type: "vote", actorId: voter.participantId, targetId: target.participantId };
  }

  return undefined;
}

export function ensureRegistered() {
  return Boolean(getGameDefinition("werewolf"));
}