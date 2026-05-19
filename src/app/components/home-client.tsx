"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { useState } from "react";

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

const roles = ["主持人", "工程师", "反方评审"];

export function HomeClient() {
  const router = useRouter();
  const [title, setTitle] = useState("AI 方案讨论室");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function createRoom(event: FormSubmitEvent) {
    event.preventDefault();
    setError("");
    setPending(true);

    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, ownerName: "用户" }),
    });

    const data = await response.json();
    setPending(false);

    if (!response.ok) {
      setError(data.error || "创建房间失败");
      return;
    }

    router.push(`/rooms/${data.room.id}`);
  }

  return (
    <main className="page shell">
      <section className="hero">
        <p className="eyebrow">AI Discussion Room</p>
        <h1>把多个 AI 拉进同一个讨论室。</h1>
        <p className="summary">
          创建房间，设置议题，让不同分工的 AI 角色依次发言。当前阶段已接入内存版房间、成员和消息流程。
        </p>
        <form className="createForm" onSubmit={createRoom}>
          <label htmlFor="roomTitle">房间标题</label>
          <input id="roomTitle" value={title} onChange={(event) => setTitle(event.target.value)} />
          {error ? <p className="formError">{error}</p> : null}
          <div className="actions">
            <button className="primary" disabled={pending} type="submit">
              {pending ? "创建中" : "创建讨论室"}
            </button>
            <a className="secondary" href="#roles">
              查看首批角色
            </a>
          </div>
        </form>
      </section>

      <section className="panel" id="roles" aria-label="首批 AI 角色">
        <h2>首批角色</h2>
        <div className="roleGrid">
          {roles.map((role) => (
            <article className="roleCard" key={role}>
              <span>{role}</span>
              <p>创建房间后可以加入讨论室。</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}