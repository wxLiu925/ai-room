"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { GameSession, GameSystemEvent } from "@/domain/game-types";
import type { ProviderClientConfig } from "@/domain/provider";
import type { Participant, RoomView } from "@/domain/types";

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

type WerewolfClientProps = {
  initialRoom: RoomView;
  providerConfig: ProviderClientConfig;
};

type WerewolfState = {
  round?: number;
  winner?: "werewolf" | "village" | null;
  lastEliminated?: { participantId: string; reason: "night_kill" | "vote_out" } | null;
};

const defaultAgentSeats = [
  { name: "ChatGPT", role: "AI 玩家", persona: "理性发言，引导逻辑分析。" },
  { name: "Claude", role: "AI 玩家", persona: "稳健保守，注重证据。" },
  { name: "Gemini", role: "AI 玩家", persona: "整合各方意见，强调风险点。" },
  { name: "Deepseek", role: "AI 玩家", persona: "直觉派，主动挑战质疑。" },
  { name: "Grok", role: "AI 玩家", persona: "节奏活跃，制造话题。" },
  { name: "Qwen", role: "AI 玩家", persona: "细致谨慎，重视细节。" },
];

const phaseLabels: Record<string, string> = {
  lobby: "等待开始",
  night_werewolf: "夜晚 · 狼人行动",
  night_seer: "夜晚 · 预言家查验",
  day_announce: "白天 · 公布昨夜",
  day_discuss: "白天 · 自由讨论",
  day_vote: "白天 · 投票",
  ended: "游戏结束",
};

const roleLabels: Record<string, string> = {
  werewolf: "狼人",
  seer: "预言家",
  villager: "村民",
  hidden: "未知",
};

const roleIcons: Record<string, string> = {
  werewolf: "🐺",
  seer: "🔮",
  villager: "👤",
  hidden: "❔",
};

function nameByParticipantId(room: RoomView, participantId: string | undefined) {
  if (!participantId) return "玩家";
  return room.participants.find((participant) => participant.id === participantId)?.name ?? "玩家";
}

function eventBubble(room: RoomView, event: GameSystemEvent): { text: string; icon: string } | undefined {
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "game.created":
      return { text: `开始游戏：${payload.playerCount} 人入座，请尽快分析谁是狼人。`, icon: "🎬" };
    case "round.started":
      return { text: `第 ${payload.round} 晚，天黑请闭眼…`, icon: "🌙" };
    case "phase.changed":
      return { text: `${phaseLabels[payload.phase as string] ?? payload.phase}`, icon: "⏱" };
    case "night.kill":
      return { text: `昨夜 ${payload.name} 倒在了房间里，他/她已经离开游戏。`, icon: "💀" };
    case "night.peaceful":
      return { text: "昨夜平安，无人死亡。", icon: "🌤" };
    case "vote.out":
      return { text: `${payload.name} 被放逐。身份揭晓：${roleLabels[payload.role as string] ?? payload.role}。`, icon: "⚖️" };
    case "vote.tied":
      return { text: "投票平票，本轮无人被放逐。", icon: "⚖️" };
    case "game.ended":
      return { text: payload.winner === "werewolf" ? "🐺 狼人阵营胜利！" : "🛡 村民阵营胜利！", icon: "🏁" };
    case "player.said":
      return undefined; // 渲染为发言段
    case "player.voted":
      return { text: `${payload.name} 投出了一票。`, icon: "🗳" };
    case "seer.checked.private":
      return {
        text: `🔮 你查验了 ${nameByParticipantId(room, payload.targetId as string)}：${payload.result === "werewolf" ? "是狼人" : "是好人"}。`,
        icon: "🔮",
      };
    default:
      return undefined;
  }
}

export function WerewolfClient({ initialRoom, providerConfig }: WerewolfClientProps) {
  const [room, setRoom] = useState<RoomView>(initialRoom);
  const [session, setSession] = useState<GameSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState("");
  const [agentProvider, setAgentProvider] = useState(providerConfig.defaultProvider);
  const providerDescriptor = useMemo(
    () => providerConfig.providers.find((entry) => entry.id === agentProvider) ?? providerConfig.providers[0],
    [agentProvider, providerConfig.providers],
  );
  const [agentModel, setAgentModel] = useState(providerDescriptor?.defaultModel ?? "");
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastSeqRef = useRef(Math.max(0, ...initialRoom.events.map((event) => event.seq)));

  const viewerId = useMemo(() => {
    return room.participants.find((participant) => participant.kind === "human")?.id;
  }, [room.participants]);

  const viewerPlayer = useMemo(() => {
    if (!session || !viewerId) return undefined;
    return session.players.find((player) => player.participantId === viewerId);
  }, [session, viewerId]);

  const viewerRole = viewerPlayer?.role ?? "hidden";
  const viewerRoleLabel = roleLabels[viewerRole] ?? viewerRole;
  const viewerAlive = viewerPlayer?.alive ?? false;
  const viewerWolfTeammates = (viewerPlayer?.privateState?.knownWolves as string[] | undefined) ?? [];
  const aliveCount = session ? session.players.filter((player) => player.alive).length : 0;
  const totalCount = session?.players.length ?? 0;
  const phase = session?.phase ?? "lobby";
  const state = (session?.state ?? {}) as WerewolfState;
  const round = state.round ?? 0;

  const applyRoom = useCallback((nextRoom: RoomView) => {
    const nextSeq = Math.max(0, ...nextRoom.events.map((event) => event.seq));
    if (nextSeq < lastSeqRef.current) return;
    lastSeqRef.current = nextSeq;
    setRoom(nextRoom);
  }, []);

  const fetchActive = useCallback(async () => {
    if (!viewerId) return;
    try {
      const response = await fetch(`/api/rooms/${initialRoom.room.id}/games/active?viewerId=${viewerId}`);
      if (!response.ok) return;
      const data = (await response.json().catch(() => null)) as { session: GameSession | null } | null;
      if (data?.session) setSession(data.session);
    } catch {
      setError("读取游戏状态失败");
    }
  }, [initialRoom.room.id, viewerId]);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("room:join", { roomId: initialRoom.room.id, lastSeq: lastSeqRef.current });
      void fetchActive();
    });

    socket.on("room:updated", (payload: { room: RoomView }) => {
      if (!payload?.room?.room?.id) return;
      applyRoom(payload.room);
    });

    socket.on("game:updated", (payload: { session: GameSession }) => {
      if (!payload?.session) return;
      void fetchActive();
    });

    return () => {
      socket.emit("room:leave", { roomId: initialRoom.room.id });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applyRoom, fetchActive, initialRoom.room.id]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [session?.events.length]);

  async function addDefaultAgents(targetCount: number) {
    setPending(true);
    setError("");
    try {
      const existing = room.participants.filter((participant) => participant.kind === "ai").length;
      const need = Math.max(0, targetCount - existing);
      for (let i = 0; i < need; i += 1) {
        const agent = defaultAgentSeats[(existing + i) % defaultAgentSeats.length];
        const response = await fetch(`/api/rooms/${room.room.id}/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...agent, provider: agentProvider, model: agentModel.trim() || undefined }),
        });
        const data = (await response.json().catch(() => null)) as RoomView | null;
        if (response.ok && data?.room) applyRoom(data);
      }
    } catch {
      setError("添加 AI 玩家失败");
    } finally {
      setPending(false);
    }
  }

  async function startGame() {
    setPending(true);
    setError("");
    try {
      if (room.participants.length < 4) {
        await addDefaultAgents(5);
      }
      const response = await fetch(`/api/rooms/${room.room.id}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameType: "werewolf" }),
      });
      const raw = await response.text();
      let data: { session?: GameSession; error?: string } | null = null;
      try {
        data = raw ? (JSON.parse(raw) as { session?: GameSession; error?: string }) : null;
      } catch {
        data = null;
      }
      if (!response.ok || !data?.session) {
        const detail = data?.error ?? raw?.slice(0, 300) ?? `HTTP ${response.status} ${response.statusText}`;
        console.error("[werewolf] create failed", { status: response.status, detail, raw });
        setError(`创建游戏失败：${detail}`);
        return;
      }
      await fetchActive();
    } catch (err) {
      console.error("[werewolf] create exception", err);
      setError(`创建游戏失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPending(false);
    }
  }

  async function submitAction(input: { type: string; targetId?: string; payload?: Record<string, unknown> }) {
    if (!session || !viewerId) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${room.room.id}/games/${session.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, actorId: viewerId }),
      });
      const data = (await response.json().catch(() => null)) as { session?: GameSession; error?: string } | null;
      if (!response.ok || !data?.session) {
        setError(data?.error ?? "操作失败");
        return;
      }
      setSession(data.session);
    } catch {
      setError("操作失败");
    } finally {
      setPending(false);
    }
  }

  async function readyUp() {
    await submitAction({ type: "ready" });
  }

  async function sendMessage(event: FormSubmitEvent) {
    event.preventDefault();
    const text = composer.trim();
    if (!text) return;
    await submitAction({ type: "say", payload: { text } });
    setComposer("");
  }

  function targetOptions(predicate: (player: GameSession["players"][number]) => boolean) {
    if (!session) return [];
    return session.players.filter(predicate).map((player) => ({
      participantId: player.participantId,
      name: nameByParticipantId(room, player.participantId),
      role: player.role,
      alive: player.alive,
    }));
  }

  const renderedFeed = useMemo(() => {
    if (!session) return [] as Array<{ kind: "system" | "say"; key: string; content: React.ReactNode }>;

    const blocks: Array<{ kind: "system" | "say"; key: string; content: React.ReactNode }> = [];

    for (const event of session.events) {
      if (event.type === "player.said") {
        const payload = event.payload as { participantId: string; name: string; text: string };
        const isHuman = payload.participantId === viewerId;
        blocks.push({
          kind: "say",
          key: event.id,
          content: isHuman ? (
            <div className="ww-sayHuman" key={event.id}>
              <div className="ww-sayHumanInner">
                <div className="ww-sayName">{payload.name}</div>
                <div className="ww-sayText">{payload.text}</div>
              </div>
            </div>
          ) : (
            <div className="ww-say" key={event.id}>
              <div className="ww-sayName">{payload.name}</div>
              <div className="ww-sayText">{payload.text}</div>
            </div>
          ),
        });
        continue;
      }

      const bubble = eventBubble(room, event);
      if (!bubble) continue;
      blocks.push({
        kind: "system",
        key: event.id,
        content: (
          <div className="ww-systemBubble" key={event.id}>
            <span className="ww-systemIcon">{bubble.icon}</span>
            <span>{bubble.text}</span>
          </div>
        ),
      });
    }

    return blocks;
  }, [session, room, viewerId]);

  const actionBar = (() => {
    if (!session) return null;
    if (!viewerAlive && phase !== "ended") {
      return <div className="ww-actionHint">你已出局，静观其变。</div>;
    }
    if (phase === "lobby") {
      const isReady = viewerPlayer?.publicState?.ready === true;
      return (
        <div className="ww-actionRow">
          <button className="primary" disabled={pending || isReady} onClick={readyUp} type="button">
            {isReady ? "已准备，等待其他玩家" : "我准备好了"}
          </button>
        </div>
      );
    }
    if (phase === "night_werewolf" && viewerRole === "werewolf" && viewerAlive) {
      const targets = targetOptions((player) => player.alive && player.role !== "werewolf");
      const voted = typeof viewerPlayer?.privateState?.nightKillVote === "string";
      return (
        <div className="ww-actionBlock">
          <div className="ww-actionTitle">选择今晚要击杀的玩家</div>
          <div className="ww-targetRow">
            {targets.map((target) => (
              <button
                className="ww-targetBtn"
                disabled={pending || voted}
                key={target.participantId}
                onClick={() => submitAction({ type: "kill", targetId: target.participantId })}
                type="button"
              >
                {target.name}
              </button>
            ))}
          </div>
          {voted ? <div className="ww-actionHint">你已选择，等待同伴。</div> : null}
        </div>
      );
    }
    if (phase === "night_seer" && viewerRole === "seer" && viewerAlive) {
      const targets = targetOptions((player) => player.alive && player.participantId !== viewerId);
      const checked = typeof viewerPlayer?.privateState?.checked === "object";
      return (
        <div className="ww-actionBlock">
          <div className="ww-actionTitle">选择要查验身份的玩家</div>
          <div className="ww-targetRow">
            {targets.map((target) => (
              <button
                className="ww-targetBtn"
                disabled={pending || checked}
                key={target.participantId}
                onClick={() => submitAction({ type: "check", targetId: target.participantId })}
                type="button"
              >
                {target.name}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (phase === "day_discuss" && viewerAlive) {
      const spoken = viewerPlayer?.publicState?.spoken === true;
      return (
        <form className="ww-composer" onSubmit={sendMessage}>
          <input
            disabled={pending || spoken}
            maxLength={500}
            onChange={(event) => setComposer(event.target.value)}
            placeholder={spoken ? "你已发言，等待他人…" : "输入你的发言"}
            value={composer}
          />
          <button className="primary" disabled={pending || spoken || !composer.trim()} type="submit">
            发言
          </button>
        </form>
      );
    }
    if (phase === "day_vote" && viewerAlive) {
      const targets = targetOptions((player) => player.alive && player.participantId !== viewerId);
      const voted = typeof viewerPlayer?.privateState?.dayVote === "string";
      return (
        <div className="ww-actionBlock">
          <div className="ww-actionTitle">投票放逐你怀疑的玩家</div>
          <div className="ww-targetRow">
            {targets.map((target) => (
              <button
                className="ww-targetBtn"
                disabled={pending || voted}
                key={target.participantId}
                onClick={() => submitAction({ type: "vote", targetId: target.participantId })}
                type="button"
              >
                {target.name}
              </button>
            ))}
          </div>
          {voted ? <div className="ww-actionHint">已投票，等待唱票。</div> : null}
        </div>
      );
    }
    if (phase === "ended") {
      return (
        <div className="ww-actionRow">
          <Link className="secondary" href="/">
            返回首页
          </Link>
          <button className="primary" disabled={pending} onClick={startGame} type="button">
            再来一局
          </button>
        </div>
      );
    }
    return <div className="ww-actionHint">等待 AI 行动中…</div>;
  })();

  const lobbyScreen = !session && (
    <div className="ww-lobby">
      <div className="ww-lobbyCard">
        <p className="eyebrow">Werewolf · 狼人杀</p>
        <h2>{room.room.title}</h2>
        <p className="ww-lobbyDesc">
          当前 {room.participants.length} 名玩家（含 {room.participants.filter((participant: Participant) => participant.kind === "ai").length} 位 AI）。
          建议 5–8 人对局，少于 4 人无法开始。
        </p>
        <div className="ww-seatGrid">
          {room.participants.map((participant) => (
            <div className={`ww-seat ww-seat-${participant.kind}`} key={participant.id}>
              <span>{participant.kind === "human" ? "👤" : "🤖"}</span>
              <strong>{participant.name}</strong>
              <small>{participant.kind === "human" ? "你" : "AI"}</small>
            </div>
          ))}
        </div>
        <div className="ww-lobbyActions">
          <label className="stackedField ww-providerField" htmlFor="wwAgentProvider">
            AI 模型 Provider
            <select
              id="wwAgentProvider"
              onChange={(event) => {
                const next = event.target.value as typeof agentProvider;
                setAgentProvider(next);
                const target = providerConfig.providers.find((entry) => entry.id === next);
                if (target) setAgentModel(target.defaultModel);
              }}
              value={agentProvider}
            >
              {providerConfig.providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                  {entry.kind !== "mock" && !entry.configured ? "（未配置 Key）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="stackedField ww-providerField" htmlFor="wwAgentModel">
            模型名称
            <input
              id="wwAgentModel"
              maxLength={64}
              onChange={(event) => setAgentModel(event.target.value)}
              placeholder={providerDescriptor?.defaultModel ?? "默认模型"}
              value={agentModel}
            />
          </label>
          <button className="secondary" disabled={pending} onClick={() => addDefaultAgents(6)} type="button">
            一键凑齐 6 人
          </button>
          <button className="primary" disabled={pending || room.participants.length < 4} onClick={startGame} type="button">
            {pending ? "准备中…" : "开始狼人杀"}
          </button>
        </div>
        {error ? <p className="formError">{error}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="ww-layout">
      <header className="ww-topbar">
        <div className="ww-topbarLeft">
          <Link className="backLink" href="/" aria-label="返回">
            ←
          </Link>
          <span className="ww-brand">🐺 狼人杀</span>
          {session ? (
            <>
              <span className={`ww-phasePill ww-phase-${phase}`}>{phaseLabels[phase] ?? phase}</span>
              <span className="ww-meta">第 {round || 1} 轮</span>
              <span className="ww-meta">
                存活 {aliveCount}/{totalCount}
              </span>
            </>
          ) : null}
        </div>
        {session && phase === "ended" && state.winner ? (
          <div className={`ww-winnerBadge ww-winner-${state.winner}`}>
            {state.winner === "werewolf" ? "🐺 狼人胜" : "🛡 村民胜"}
          </div>
        ) : null}
      </header>

      {lobbyScreen}

      {session ? (
        <div className="ww-body">
          <aside className="ww-side">
            <div className="ww-roleCard">
              <div className="ww-roleIcon">{roleIcons[viewerRole]}</div>
              <strong>你的身份</strong>
              <span className={`ww-roleLabel ww-role-${viewerRole}`}>
                {roleIcons[viewerRole]} {viewerRoleLabel}
              </span>
              <small>{viewerAlive ? `状态：存活` : `状态：出局`}</small>
              {viewerRole === "werewolf" && viewerWolfTeammates.length > 1 ? (
                <small className="ww-teammates">
                  狼队友：
                  {viewerWolfTeammates
                    .filter((id) => id !== viewerId)
                    .map((id) => nameByParticipantId(room, id))
                    .join("、")}
                </small>
              ) : null}
            </div>

            <div className="ww-seatList">
              <h3>玩家列表</h3>
              {session.players.map((player) => {
                const name = nameByParticipantId(room, player.participantId);
                const isMe = player.participantId === viewerId;
                const showRole = player.role !== "hidden";
                return (
                  <div className={`ww-player ${player.alive ? "" : "ww-dead"}`} key={player.participantId}>
                    <span className={`ww-dot ww-dot-${player.alive ? "alive" : "dead"}`} />
                    <span className="ww-playerName">
                      {name}
                      {isMe ? <small> · 你</small> : null}
                    </span>
                    {showRole ? <span className={`ww-roleTag ww-role-${player.role}`}>{roleIcons[player.role]}</span> : null}
                  </div>
                );
              })}
            </div>
          </aside>

          <main className="ww-main">
            <div className="ww-feed" ref={messageListRef}>
              {renderedFeed.map((block) => block.content)}
            </div>
            {error ? <div className="errorBar">{error}</div> : null}
            <div className="ww-actionBar">{actionBar}</div>
          </main>
        </div>
      ) : null}
    </div>
  );
}