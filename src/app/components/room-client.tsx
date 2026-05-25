"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ProviderClientConfig } from "@/domain/provider";
import type { Message, Participant, RoomEvent, RoomView } from "@/domain/types";

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

type RoomClientProps = {
  initialRoom: RoomView;
  providerConfig: ProviderClientConfig;
};

type RoomRealtimePayload = {
  room: RoomView;
  events: RoomEvent[];
};

type RoomSnapshot = RoomView & {
  missingEvents?: RoomEvent[];
};

const defaultAgents = [
  { name: "主持人 AI", role: "主持人", persona: "控制节奏，追问关键分歧，最后收束结论。" },
  { name: "工程师 AI", role: "工程师", persona: "关注实现路径、技术风险、边界条件和交付成本。" },
  { name: "反方评审 AI", role: "反方评审", persona: "主动寻找薄弱假设、失败场景和反例。" },
];

const statusLabels: Record<string, string> = {
  online: "在线",
  offline: "等待",
  thinking: "思考中",
  speaking: "发言中",
  completed: "已发言",
  failed: "失败",
};

const roomStatusLabels: Record<string, string> = {
  open: "空闲",
  running: "讨论中",
  archived: "已归档",
};

function isRoomView(value: unknown): value is RoomView {
  const roomView = value as RoomView;

  return (
    typeof roomView?.room?.id === "string" &&
    Array.isArray(roomView.participants) &&
    Array.isArray(roomView.agents) &&
    Array.isArray(roomView.messages) &&
    Array.isArray(roomView.events)
  );
}

function lastEventSeq(events: RoomEvent[]) {
  return events.reduce((maxSeq, event) => (typeof event?.seq === "number" ? Math.max(maxSeq, event.seq) : maxSeq), 0);
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function errorMessage(value: unknown, fallback: string) {
  const error = (value as { error?: unknown })?.error;
  return typeof error === "string" && error ? error : fallback;
}

function statusLabel(participant: Participant) {
  if (participant.kind === "human") return "在线";
  return statusLabels[participant.status] ?? participant.status;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function avatarLetter(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function RoomClient({ initialRoom, providerConfig }: RoomClientProps) {
  const [room, setRoom] = useState<RoomView>(initialRoom);
  const [error, setError] = useState("");
  const [agentIndex, setAgentIndex] = useState(0);
  const [agentName, setAgentName] = useState("主持人 AI");
  const [agentRole, setAgentRole] = useState("主持人");
  const [agentPersona, setAgentPersona] = useState("控制节奏，追问关键分歧，最后收束结论。");
  const [agentProvider, setAgentProvider] = useState(providerConfig.defaultProvider);
  const providerDescriptor = useMemo(
    () => providerConfig.providers.find((entry) => entry.id === agentProvider) ?? providerConfig.providers[0],
    [agentProvider, providerConfig.providers],
  );
  const [agentModel, setAgentModel] = useState(providerDescriptor?.defaultModel ?? "");
  const [discussionGoal, setDiscussionGoal] = useState("围绕当前方案做第一轮可执行评审。");
  const [message, setMessage] = useState("请围绕这个方案给出第一轮意见。");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const lastSeqRef = useRef(Math.max(0, ...initialRoom.events.map((event) => event.seq)));

  const round = room.events.filter((event) => event.type === "discussion.started").length;
  const currentSpeaker = room.participants.find((participant) => participant.status === "speaking");
  const thinkingCount = room.participants.filter((participant) => participant.status === "thinking").length;
  const aiCount = room.participants.filter((participant) => participant.kind === "ai").length;
  const humanCount = room.participants.filter((participant) => participant.kind === "human").length;
  const lastVisibleSeq = lastEventSeq(room.events);
  const roomStatusText = roomStatusLabels[room.room.status] ?? room.room.status;

  const sortedMembers = useMemo(() => {
    const order: Record<string, number> = { speaking: 0, thinking: 1, online: 2, completed: 3, offline: 4, failed: 5 };
    return [...room.participants].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [room.participants]);

  const applyRoom = useCallback((nextRoom: RoomView) => {
    const nextSeq = lastEventSeq(nextRoom.events);
    if (nextSeq < lastSeqRef.current) return;
    lastSeqRef.current = nextSeq;
    setRoom(nextRoom);
  }, []);

  const fetchMissingEvents = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${initialRoom.room.id}?afterSeq=${lastSeqRef.current}`);
      if (!response.ok) return;
      const data = (await response.json().catch(() => null)) as RoomSnapshot | null;
      if (isRoomView(data)) applyRoom(data);
    } catch {
      setError("同步房间状态失败");
    }
  }, [applyRoom, initialRoom.room.id]);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("room:join", { roomId: initialRoom.room.id, lastSeq: lastSeqRef.current });
      void fetchMissingEvents();
    });

    socket.on("room:updated", (payload: RoomRealtimePayload) => {
      if (!isRoomView(payload?.room) || !Array.isArray(payload.events)) return;
      const eventMaxSeq = lastEventSeq(payload.events);
      if (eventMaxSeq <= lastSeqRef.current) return;
      applyRoom(payload.room);
    });

    return () => {
      socket.emit("room:leave", { roomId: initialRoom.room.id });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applyRoom, fetchMissingEvents, initialRoom.room.id]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [room.messages.length]);

  function senderName(item: Message) {
    if (item.senderKind === "human") return "用户";
    const participant = room.participants.find((entry) => entry.id === item.senderId);
    const agent = room.agents.find((entry) => entry.id === participant?.agentId || entry.id === item.metadata.agentId);
    return agent?.name ?? participant?.name ?? "AI";
  }

  async function createAgent(input: { name: string; role: string; persona?: string; provider?: string; model?: string }) {
    setError("");
    setPending(true);

    try {
      const response = await fetch(`/api/rooms/${room.room.id}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await readJson(response);

      if (!response.ok) {
        setError(errorMessage(data, "添加 AI 失败"));
        return;
      }
      if (!isRoomView(data)) {
        setError("房间数据格式错误");
        return;
      }
      applyRoom(data);
    } catch {
      setError("添加 AI 失败");
    } finally {
      setPending(false);
    }
  }

  async function addNextAgent() {
    const agent = defaultAgents[agentIndex % defaultAgents.length];
    await createAgent({ ...agent, provider: agentProvider, model: agentModel.trim() || undefined });
    setAgentIndex((value) => value + 1);
  }

  async function addCustomAgent(event: FormSubmitEvent) {
    event.preventDefault();
    const name = agentName.trim();
    const role = agentRole.trim();
    const persona = agentPersona.trim();

    if (!name || !role) {
      setError("AI 名称和角色不能为空");
      return;
    }
    await createAgent({ name, role, persona, provider: agentProvider, model: agentModel.trim() || undefined });
  }

  async function sendMessage(event: FormSubmitEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setError("");
    setPending(true);

    try {
      const response = await fetch(`/api/rooms/${room.room.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
      const data = await readJson(response);

      if (!response.ok) {
        setError(errorMessage(data, "发送消息失败"));
        return;
      }
      if (!isRoomView(data)) {
        setError("房间数据格式错误");
        return;
      }
      setMessage("");
      applyRoom(data);
    } catch {
      setError("发送消息失败");
    } finally {
      setPending(false);
    }
  }

  async function startDiscussion() {
    setError("");
    setPending(true);

    try {
      const response = await fetch(`/api/rooms/${room.room.id}/discussions/start`, { method: "POST" });
      const data = await readJson(response);

      if (!response.ok) {
        setError(errorMessage(data, "启动讨论失败"));
        return;
      }
      if (!isRoomView(data)) {
        setError("房间数据格式错误");
        return;
      }
      applyRoom(data);
    } catch {
      setError("启动讨论失败");
    } finally {
      setPending(false);
    }
  }

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(room.room.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("复制失败");
    }
  }

  function composerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      const form = event.currentTarget.form;
      if (form) form.requestSubmit();
    }
  }

  return (
    <div className="roomLayout">
      <header className="roomTopbar">
        <div className="topbarLeft">
          <Link className="backLink" href="/" aria-label="返回首页">
            ←
          </Link>
          <div className="topbarTitle">
            <h1>{room.room.title}</h1>
            <div className="topbarMeta">
              <span className={`statusBadge status-room-${room.room.status}`}>{roomStatusText}</span>
              <span className="metaItem">Round {round}</span>
              <span className="metaItem">
                {humanCount} 人 · {aiCount} AI
              </span>
            </div>
          </div>
        </div>
        <div className="topbarRight">
          <button className="ghost" onClick={copyRoomId} type="button">
            {copied ? "已复制" : "复制房间 ID"}
          </button>
          <button
            className="primary"
            disabled={pending || room.agents.length === 0}
            onClick={startDiscussion}
            type="button"
          >
            {pending ? "运行中…" : "启动一轮讨论"}
          </button>
        </div>
      </header>

      <div className="roomBody">
        <aside className="roomLeft">
          <div className="paneHeader">
            <h3>成员</h3>
            <span>{room.participants.length}</span>
          </div>

          {currentSpeaker ? (
            <div className="speakerCard">
              <span>当前发言</span>
              <strong>{currentSpeaker.name}</strong>
              <small>{thinkingCount > 0 ? `${thinkingCount} 个 AI 排队中` : "下一位待定"}</small>
            </div>
          ) : (
            <div className="speakerCard idle">
              <span>当前状态</span>
              <strong>等待启动</strong>
              <small>{thinkingCount > 0 ? `${thinkingCount} 个 AI 思考中` : "无排队任务"}</small>
            </div>
          )}

          <div className="memberList">
            {sortedMembers.map((participant) => (
              <div className="member" key={participant.id}>
                <span className={`avatar avatar-${participant.kind}`}>{avatarLetter(participant.name)}</span>
                <div className="memberInfo">
                  <span className="memberName">{participant.name}</span>
                  <small className="memberKind">{participant.kind === "human" ? "Human" : "AI"}</small>
                </div>
                <small className={`statusPill status-${participant.status}`}>{statusLabel(participant)}</small>
              </div>
            ))}
          </div>

          <button className="ghost paneAction" disabled={pending} onClick={addNextAgent} type="button">
            + 快速添加 AI
          </button>
        </aside>

        <section className="roomCenter">
          <div className="messageList" ref={messageListRef}>
            {room.messages.length === 0 ? (
              <div className="emptyState">
                <p className="emptyTitle">还没有消息</p>
                <p className="emptyDesc">配置议题、添加 AI 角色，然后发送第一条消息或启动一轮讨论。</p>
              </div>
            ) : null}
            {room.messages.map((item) => (
              <div className={`message message-${item.senderKind}`} key={item.id}>
                <div className="messageMeta">
                  <span>{senderName(item)}</span>
                  <small>{formatTime(item.createdAt)}</small>
                </div>
                <p>{item.content}</p>
              </div>
            ))}
          </div>

          {error ? <div className="errorBar">{error}</div> : null}

          <form className="composer" onSubmit={sendMessage}>
            <textarea
              maxLength={2000}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={composerKeyDown}
              placeholder="输入消息，⌘/Ctrl + Enter 发送"
              rows={2}
              value={message}
            />
            <div className="composerActions">
              <small className="composerHint">{message.length}/2000</small>
              <button className="primary" disabled={pending || !message.trim()} type="submit">
                发送
              </button>
            </div>
          </form>
        </section>

        <aside className="roomRight">
          <div className="paneHeader">
            <h3>议题</h3>
            <span>Topic</span>
          </div>
          <textarea
            className="goalInput"
            maxLength={400}
            onChange={(event) => setDiscussionGoal(event.target.value)}
            placeholder="一句话描述本轮讨论目标"
            value={discussionGoal}
          />

          <div className="paneHeader">
            <h3>添加 AI</h3>
            <span>Agent</span>
          </div>
          <form className="agentForm" onSubmit={addCustomAgent}>
            <label className="stackedField" htmlFor="agentName">
              名称
              <input
                id="agentName"
                maxLength={40}
                onChange={(event) => setAgentName(event.target.value)}
                value={agentName}
              />
            </label>
            <label className="stackedField" htmlFor="agentRole">
              角色
              <input
                id="agentRole"
                maxLength={40}
                onChange={(event) => setAgentRole(event.target.value)}
                value={agentRole}
              />
            </label>
            <label className="stackedField" htmlFor="agentPersona">
              风格
              <textarea
                id="agentPersona"
                maxLength={400}
                onChange={(event) => setAgentPersona(event.target.value)}
                rows={3}
                value={agentPersona}
              />
            </label>
            <label className="stackedField" htmlFor="agentProvider">
              模型 Provider
              <select
                id="agentProvider"
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
            <label className="stackedField" htmlFor="agentModel">
              模型名称
              <input
                id="agentModel"
                maxLength={64}
                onChange={(event) => setAgentModel(event.target.value)}
                placeholder={providerDescriptor?.defaultModel ?? "默认模型"}
                value={agentModel}
              />
            </label>
            <button className="secondary actionButton" disabled={pending} type="submit">
              添加到房间
            </button>
          </form>

          <div className="paneFooter">
            <div>
              <small>事件序号</small>
              <code>#{lastVisibleSeq}</code>
            </div>
            <div>
              <small>消息总数</small>
              <code>{room.messages.length}</code>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}