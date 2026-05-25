"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

type RoomListItem = {
  id: string;
  title: string;
  mode: string;
  status: string;
  updatedAt: string;
};

type EntryTab = "create" | "join";
type CreateMode = "discussion" | "werewolf";

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function errorMessage(value: unknown, fallback: string) {
  const error = (value as { error?: unknown })?.error;
  return typeof error === "string" && error ? error : fallback;
}

function isCreatedRoom(value: unknown): value is { room: { id: string } } {
  return typeof (value as { room?: { id?: unknown } })?.room?.id === "string";
}

function isRoomList(value: unknown): value is { rooms: RoomListItem[] } {
  const rooms = (value as { rooms?: unknown })?.rooms;
  return Array.isArray(rooms);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚更新" : date.toLocaleString("zh-CN", { hour12: false });
}

function shortId(value: string) {
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

export function HomeClient() {
  const router = useRouter();
  const [tab, setTab] = useState<EntryTab>("create");
  const [mode, setMode] = useState<CreateMode>("discussion");
  const [title, setTitle] = useState("AI 方案讨论室");
  const [ownerName, setOwnerName] = useState("用户");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadRooms() {
      try {
        const response = await fetch("/api/rooms", { cache: "no-store" });
        const data = await readJson(response);
        if (!cancelled && response.ok && isRoomList(data)) setRooms(data.rooms);
      } catch {
        if (!cancelled) setError("读取房间列表失败");
      } finally {
        if (!cancelled) setLoadingRooms(false);
      }
    }

    void loadRooms();

    return () => {
      cancelled = true;
    };
  }, []);

  async function createRoom(event: FormSubmitEvent) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, ownerName, mode }),
      });
      const data = await readJson(response);

      if (!response.ok) {
        setError(errorMessage(data, "创建房间失败"));
        return;
      }

      if (!isCreatedRoom(data)) {
        setError("房间数据格式错误");
        return;
      }

      router.push(`/rooms/${data.room.id}`);
    } catch {
      setError("创建房间失败");
    } finally {
      setPending(false);
    }
  }

  function joinRoom(event: FormSubmitEvent) {
    event.preventDefault();
    const roomId = joinRoomId.trim();
    if (!roomId) {
      setError("请输入房间 ID");
      return;
    }
    router.push(`/rooms/${roomId}`);
  }

  return (
    <div className="landing">
      <nav className="topnav">
        <div className="brand">
          <span className="brandDot" aria-hidden />
          <strong>AI Room</strong>
        </div>
        <span className="navHint">多 AI 协作讨论室</span>
      </nav>

      <main className="landingMain">
        <section className="landingHero">
          <p className="eyebrow">AI Discussion Room</p>
          <h1>
            把多个 AI 拉进
            <br />
            同一个讨论室
          </h1>
          <p className="summary">
            创建房间，配置议题和 AI 角色，让不同分工的 AI 依次发言。默认内存运行，部署时可接入 PostgreSQL 持久化。
          </p>
        </section>

        <section className="entryCard" aria-label="房间入口">
          <div className="entryTabs" role="tablist">
            <button
              className={`entryTab ${tab === "create" ? "active" : ""}`}
              onClick={() => {
                setTab("create");
                setError("");
              }}
              role="tab"
              type="button"
            >
              创建房间
            </button>
            <button
              className={`entryTab ${tab === "join" ? "active" : ""}`}
              onClick={() => {
                setTab("join");
                setError("");
              }}
              role="tab"
              type="button"
            >
              加入房间
            </button>
          </div>

          {tab === "create" ? (
            <form className="entryForm" onSubmit={createRoom}>
              <div className="modeCards">
                <button
                  className={`modeCard ${mode === "discussion" ? "active" : ""}`}
                  onClick={() => setMode("discussion")}
                  type="button"
                >
                  <span className="modeIcon">💬</span>
                  <strong>讨论室</strong>
                  <small>多 AI 协作讨论议题</small>
                </button>
                <button
                  className={`modeCard ${mode === "werewolf" ? "active" : ""}`}
                  onClick={() => setMode("werewolf")}
                  type="button"
                >
                  <span className="modeIcon">🐺</span>
                  <strong>狼人杀</strong>
                  <small>身份博弈 · AI 自动入座</small>
                </button>
              </div>
              <label className="stackedField" htmlFor="roomTitle">
                房间标题
                <input
                  id="roomTitle"
                  maxLength={80}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={mode === "werewolf" ? "给这局狼人杀起个名字" : "给这场讨论起个名字"}
                />
              </label>
              <label className="stackedField" htmlFor="ownerName">
                你的名称
                <input
                  id="ownerName"
                  maxLength={40}
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  placeholder="将作为房主显示"
                />
              </label>
              {error ? <p className="formError">{error}</p> : null}
              <button className="primary entryAction" disabled={pending || !title.trim()} type="submit">
                {pending ? "创建中…" : mode === "werewolf" ? "创建狼人杀房间" : "创建并进入"}
              </button>
            </form>
          ) : (
            <form className="entryForm" onSubmit={joinRoom}>
              <label className="stackedField" htmlFor="joinId">
                房间 ID
                <input
                  id="joinId"
                  value={joinRoomId}
                  onChange={(event) => setJoinRoomId(event.target.value)}
                  placeholder="粘贴 room_ 开头的 ID"
                />
              </label>
              {error ? <p className="formError">{error}</p> : null}
              <button className="primary entryAction" type="submit">
                进入房间
              </button>
            </form>
          )}
        </section>

        <section className="recentSection" aria-label="最近房间">
          <div className="sectionTitle">
            <h3>最近房间</h3>
            <span>{loadingRooms ? "读取中" : `${rooms.length} 个`}</span>
          </div>
          {rooms.length === 0 && !loadingRooms ? (
            <p className="emptyHint">还没有房间。创建一个讨论室后会出现在这里。</p>
          ) : null}
          <div className="recentGrid">
            {rooms.slice(0, 6).map((room) => (
              <a className="recentCard" href={`/rooms/${room.id}`} key={room.id}>
                <span className="recentTitle">{room.title}</span>
                <span className={`statusPill status-${room.status}`}>{room.status}</span>
                <small className="recentMeta">
                  <span>{shortId(room.id)}</span>
                  <span>{formatDate(room.updatedAt)}</span>
                </small>
              </a>
            ))}
          </div>
        </section>
      </main>

      <footer className="landingFoot">
        <span>v0.1 · 内存模式</span>
        <span>支持 mock / OpenAI provider</span>
      </footer>
    </div>
  );
}