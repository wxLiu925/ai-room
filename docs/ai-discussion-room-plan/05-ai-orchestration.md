# AI 编排

## 编排目标

AI 编排层负责把房间目标、历史消息、角色配置和调度策略组合成一次 AI 发言。它不负责页面展示，不直接修改游戏状态，也不依赖具体模型厂商。

## 最小 Agent 抽象

Agent 表示一个可参与房间的 AI 角色。

核心字段：

- `id`
- `name`
- `role`
- `persona`
- `goal`
- `provider`
- `model`
- `temperature`
- `enabled`

可后置字段：

- `avatarUrl`
- `permissions`
- `memoryScope`
- `maxTokens`
- `toolsAllowed`

## Provider 边界

Provider 只负责根据输入生成输出。Provider 不读取数据库，不修改房间状态，不判断游戏行动是否合法。

统一输入：

- `agent`
- `messages`
- `roomContext`
- `responseFormat`
- `budget`

统一输出：

- `text`
- `usage`
- `finishReason`
- `latencyMs`
- `raw`

## Mock Provider

Mock Provider 是首个实现。它用于验证流程、UI、实时状态和调度逻辑。

Mock Provider 应支持：

- 按角色生成不同风格回复。
- 模拟思考延迟。
- 模拟失败。
- 固定 seed，便于复现测试。
- 返回模拟 usage。

Mock Provider 不应伪装成真实智能。它的价值是让业务链路稳定可测。

## 真实 Provider

真实 Provider 在 mock 流程稳定后接入。业务层仍只依赖统一 Provider 接口。

真实 Provider 需要处理：

- API Key 管理。
- 超时。
- 重试。
- 错误分类。
- usage 记录。
- 成本限制。
- mock fallback。

## 调度策略

### roundRobin

AI 按固定顺序依次发言。首个 MVP 只实现该策略。

优点：

- 行为可预测。
- 状态简单。
- 易于测试。

缺点：

- 讨论不够自然。
- 不能根据内容动态决定下一个发言者。

### hostControlled

主持人或系统调度器决定下一位发言者。该策略适合方案评审和狼人杀发言阶段。

### eventTriggered

特定事件触发 AI 发言，例如被点名、被投票、受到质疑或阶段切换。

### parallel

多个 AI 同时生成意见。该策略后置，因为它会增加上下文一致性、排序和成本控制难度。

## 上下文管理

Context Manager 根据参与者权限构造可见上下文。

讨论模式上下文包含：

- 房间标题。
- 讨论目标。
- AI 角色设定。
- 最近消息。
- 当前轮次。

游戏模式上下文包含：

- 公共游戏状态。
- 当前阶段。
- 当前可执行动作。
- 该 Agent 可见的私有信息。

规则：

- 不把完整隐藏状态传给无权限 AI。
- 不把客户端提交的上下文直接转发给 Provider。
- 长消息历史需要裁剪或摘要。

## 预算控制

从 mock 阶段就保留预算字段。

控制项：

- 每房间最大轮次。
- 每轮最大 AI 数量。
- 每次调用最大 token。
- 每房间最大成本。
- 最大并发调用数。
- Provider 超时时间。

## 输出处理

AI 输出先作为候选结果返回 Orchestrator。Orchestrator 再决定写入消息、提交动作意图或标记失败。

规则：

- AI 文本可以生成消息。
- AI 工具调用必须走白名单。
- AI 游戏行动必须经过 Rule Engine 校验。
- AI 输出不能直接改变权威状态。