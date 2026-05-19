"use client";

import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { RoomEvent, RoomView } from "@/domain/types";

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

type RoomClientProps = {
  initialRoom: RoomView;
};

type RoomRealtimePayload = {
  room: RoomView;
  events: RoomEvent[];
};

type RoomSnapshot = RoomView & {
  missingEvents?: RoomEvent[];
};

const defaultAgents = [
  { name: "主持人 AI", role: "主持人" },
  { name: "工程师 AI", role: "工程师" },
  { name: "反方评审 AI", role: "反方评审" },
];

export function RoomClient({ initialRoom }: RoomClientProps) {
  const [room, setRoom] = useState<RoomView>(initialRoom);
  const [error, setError] = useState("");
  const [agentIndex, setAgentIndex] = useState(0);
  const [message, setMessage] = useState("请围绕这个方案给出第一轮意见。");
  const [pending, setPending] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const lastSeqRef = useRef(Math.max(0, ...initialRoom.events.map((event) => event.seq)));

  const applyRoom = useCallback((nextRoom: RoomView) => {
    const lastSeq = Math.max(0, ...nextRoom.events.map((event) => event.seq));
    lastSeqRef.current = Math.max(lastSeqRef.current, lastSeq);
    setRoom(nextRoom);
  }, []);

  const fetchMissingEvents = useCallback(async () => {
    const response = await fetch(`/api/rooms/${initialRoom.room.id}?afterSeq=${lastSeqRef.current}`);

    if (!response.ok) return;

    const data = (await response.json()) as RoomSnapshot;
    applyRoom(data);
  }, [applyRoom, initialRoom.room.id]);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("room:join", { roomId: initialRoom.room.id, lastSeq: lastSeqRef.current });
      void fetchMissingEvents();
    });

    socket.on("room:updated", (payload: RoomRealtimePayload) => {
      const eventMaxSeq = Math.max(0, ...payload.events.map((event) => event.seq));

      if (eventMaxSeq <= lastSeqRef.current) return;

      applyRoom(payload.room);
    });

    return () => {
      socket.emit("room:leave", { roomId: initialRoom.room.id });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applyRoom, fetchMissingEvents, initialRoom.room.id]);

  async function addNextAgent() {
    const agent = defaultAgents[agentIndex % defaultAgents.length];
    setError("");
    setPending(true);

    const response = await fetch(`/api/rooms/${room.room.id}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agent),
    });
    const data = await response.json();
    setPending(false);

    if (!response.ok) {
      setError(data.error || "添加 AI 失败");
      return;
    }

    setAgentIndex((value) => value + 1);
    applyRoom(data);
  }

  async function sendMessage(event: FormSubmitEvent) {
    event.preventDefault();
    setError("");
    setPending(true);

    const response = await fetch(`/api/rooms/${room.room.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    const data = await response.json();
    setPending(false);

    if (!response.ok) {
      setError(data.error || "发送消息失败");
      return;
    }

    setMessage("");
    applyRoom(data);
  }

  async function startDiscussion() {
    setError("");
    setPending(true);

    const response = await fetch(`/api/rooms/${room.room.id}/discussions/start`, {
      method: "POST",
    });
    const data = await response.json();
    setPending(false);

    if (!response.ok) {
      setError(data.error || "启动讨论失败");
      return;
    }

    applyRoom(data);
  }

  return (
    <main className="page roomShell">
      <aside className="sidebar">
        <p className="eyebrow">Room</p>
        <h1>{room.room.title}</h1>
        <div className="memberList">
          {room.participants.map((participant) => (
            <div className="member" key={participant.id}>
              <span>{participant.name}</span>
              <small>{participant.kind === "ai" ? participant.status : "在线"}</small>
            </div>
          ))}
        </div>
      </aside>

      <section className="timeline">
        {room.messages.length === 0 ? (
          <div className="message systemMessage">
            <span>系统</span>
            <p>房间已创建。先添加 AI 角色，或直接发送第一条消息。</p>
          </div>
        ) : null}
        {room.messages.map((item) => (
          <div className="message" key={item.id}>
            <span>{item.senderKind === "human" ? "用户" : item.senderKind}</span>
            <p>{item.content}</p>
          </div>
        ))}
        <form className="composer" onSubmit={sendMessage}>
          <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="输入消息" />
          <button className="primary" disabled={pending || !message.trim()} type="submit">
            发送
          </button>
        </form>
      </section>

      <aside className="modePanel">
        <p className="eyebrow">Discussion</p>
        <h2>Mock AI 讨论</h2>
        <p>当前房间数据保存在服务端内存中，AI 回复由 Mock Provider 生成，并按添加顺序轮流发言。</p>
        {error ? <p className="formError">{error}</p> : null}
        <button className="secondary actionButton" disabled={pending} onClick={addNextAgent} type="button">
          添加 AI 角色
        </button>
        <button className="primary actionButton" disabled={pending || room.agents.length === 0} onClick={startDiscussion} type="button">
          启动一轮讨论
        </button>
        <div className="eventList">
          <strong>事件数</strong>
          <span>{room.events.length}</span>
        </div>
      </aside>
    </main>
  );
}