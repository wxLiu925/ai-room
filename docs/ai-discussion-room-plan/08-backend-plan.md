# 后端计划

## 后端目标

后端负责房间状态、消息、AI 调度、实时事件和持久化。首版应保持单体结构清晰，不引入微服务、复杂队列或过早的平台化抽象。

## 模块划分

### Room Module

负责：

- 创建房间。
- 查询房间。
- 更新房间状态。
- 管理参与者。
- 写入房间事件。

### Message Module

负责：

- 写入消息。
- 查询历史消息。
- 分配房间内消息序号。
- 处理消息状态。

### Agent Module

负责：

- 管理 AI 角色配置。
- 将 AI 加入房间。
- 查询房间内 AI 列表。

### Orchestrator Module

负责：

- 启动讨论任务。
- 选择下一个 AI。
- 构造 Provider 输入。
- 调用 Provider。
- 写入 AI 消息。
- 发布 AI 状态事件。

### Provider Module

负责：

- 暴露统一 Provider 接口。
- 实现 Mock Provider。
- 后续实现真实 Provider。
- 记录调用耗时、usage 和错误。

### Realtime Module

负责：

- 处理房间连接。
- 广播房间事件。
- 处理客户端命令。
- 支持断线补事件。

### Game Module

负责：

- 创建游戏会话。
- 推进游戏阶段。
- 校验游戏动作。
- 保存游戏状态。

首个 MVP 只保留 Game Module 的模型边界，不实现完整狼人杀。

## API 草案

### 房间

- `POST /api/rooms`：创建房间。
- `GET /api/rooms/:id`：获取房间详情。
- `GET /api/rooms/:id/messages`：获取历史消息。
- `POST /api/rooms/:id/agents`：添加 AI。

### 讨论

- `POST /api/rooms/:id/discussions`：创建讨论任务。
- `POST /api/discussions/:id/start`：启动讨论。
- `POST /api/discussions/:id/pause`：暂停讨论。

### 游戏

- `POST /api/rooms/:id/games`：创建游戏会话。
- `GET /api/games/:id`：获取游戏状态。

## 状态推进

讨论启动后流程：

1. 用户创建 DiscussionTask。
2. Orchestrator 读取房间 AI 列表。
3. Orchestrator 按策略选择 AI。
4. 系统发布 `agent.thinking`。
5. Provider 返回文本。
6. Message Module 写入 AI 消息。
7. 系统发布 `message.created`。
8. 继续下一位 AI 或结束任务。

## 持久化顺序

同一房间内应保证事件顺序稳定。

建议流程：

1. 开启事务。
2. 读取并递增房间序号。
3. 写入业务数据。
4. 写入 RoomEvent。
5. 提交事务。
6. 广播事件。

这样可以避免事件已广播但数据库没有记录。

## 错误处理

- 用户输入错误返回明确错误码。
- AI 调用失败写入 `agent.failed` 事件。
- Provider 超时后标记该 AI 本轮失败，不阻塞整个房间。
- 持久化失败时不广播事件。
- WebSocket 命令失败时返回错误响应。

## 实现顺序

1. 内存版 Room、Participant、Message。
2. 内存版 Mock Provider 和 Orchestrator。
3. HTTP API。
4. WebSocket 房间事件。
5. PostgreSQL 持久化。
6. 真实 Provider。
7. Game Module。