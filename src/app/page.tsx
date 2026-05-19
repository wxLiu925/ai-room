import Link from "next/link";

const roles = ["主持人", "工程师", "反方评审"];

export default function Home() {
  return (
    <main className="page shell">
      <section className="hero">
        <p className="eyebrow">AI Discussion Room</p>
        <h1>把多个 AI 拉进同一个讨论室。</h1>
        <p className="summary">
          创建房间，设置议题，让不同分工的 AI 角色依次发言。当前阶段先完成可运行的 Web 骨架，后续接入房间、实时事件和 mock AI。
        </p>
        <div className="actions">
          <Link className="primary" href="/rooms/demo-room">
            进入演示房间
          </Link>
          <a className="secondary" href="#roles">
            查看首批角色
          </a>
        </div>
      </section>

      <section className="panel" id="roles" aria-label="首批 AI 角色">
        <h2>首批角色</h2>
        <div className="roleGrid">
          {roles.map((role) => (
            <article className="roleCard" key={role}>
              <span>{role}</span>
              <p>等待加入讨论流程。</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}