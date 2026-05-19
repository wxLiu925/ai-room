import type { Agent, Message } from "./types";

const roleViews: Record<string, string> = {
  host: "我会先收束议题，确保每个角色都围绕目标发言。",
  主持人: "我会先收束议题，确保每个角色都围绕目标发言。",
  engineer: "我会优先检查实现路径、边界条件和后续可验证性。",
  工程师: "我会优先检查实现路径、边界条件和后续可验证性。",
  reviewer: "我会主动指出风险、薄弱假设和需要补证据的位置。",
  反方评审: "我会主动指出风险、薄弱假设和需要补证据的位置。",
};

export function mockReply(agent: Agent, messages: Message[], round: number) {
  const latest = [...messages].reverse().find((message) => message.senderKind === "human");
  const view = roleViews[agent.role] ?? agent.persona;
  const topic = latest?.content ?? "当前讨论目标尚未明确";

  return `第 ${round} 轮，${agent.name}（${agent.role}）：${view} 当前我基于“${topic}”给出 mock 回复，后续可替换为真实 Provider。`;
}