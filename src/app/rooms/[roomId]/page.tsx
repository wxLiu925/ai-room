type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

const members = [
  { name: "用户", status: "在线" },
  { name: "主持人 AI", status: "等待" },
  { name: "工程师 AI", status: "等待" },
  { name: "反方评审 AI", status: "等待" },
];

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return (
    <main className="page roomShell">
      <aside className="sidebar">
        <p className="eyebrow">Room</p>
        <h1>{roomId}</h1>
        <div className="memberList">
          {members.map((member) => (
            <div className="member" key={member.name}>
              <span>{member.name}</span>
              <small>{member.status}</small>
            </div>
          ))}
        </div>
      </aside>

      <section className="timeline">
        <div className="message systemMessage">
          <span>系统</span>
          <p>房间骨架已就绪。下一阶段会接入内存版房间模型、消息流和 mock AI 调度。</p>
        </div>
      </section>

      <aside className="modePanel">
        <p className="eyebrow">Mode</p>
        <h2>讨论模式</h2>
        <p>当前页面只承载房间布局和静态状态，用于验证项目骨架和路由。</p>
      </aside>
    </main>
  );
}