# 领域模型

## 建模原则

领域模型只表达当前业务必需概念。不要为了未来可能出现的复杂玩法提前引入过多抽象。模型命名应短、准、稳定。

## User

表示真人用户。

核心字段：

- `id`
- `name`
- `createdAt`

后续字段：

- `email`
- `avatarUrl`
- `role`

## Room

表示一个讨论室或游戏房间。

核心字段：

- `id`
- `title`
- `mode`: `discussion` 或 `game`
- `status`: `open`、`running`、`archived`
- `ownerId`
- `createdAt`
- `updatedAt`

规则：

- 一个房间可以有多个参与者。
- 一个房间拥有独立消息流。
- 一个房间可以运行讨论任务或游戏会话。

## Participant

表示房间成员。成员可以是真人，也可以是 AI。

核心字段：

- `id`
- `roomId`
- `kind`: `human` 或 `ai`
- `userId`
- `agentId`
- `name`
- `status`: `online`、`offline`、`thinking`、`speaking`
- `createdAt`

规则：

- `kind` 为 `human` 时应关联 `userId`。
- `kind` 为 `ai` 时应关联 `agentId`。
- UI 展示房间成员时优先读取 Participant，而不是直接读取 User 或 Agent。

## Agent

表示可加入房间的 AI 角色配置。

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

后续字段：

- `avatarUrl`
- `memoryScope`
- `permissions`
- `maxTokens`

规则：

- Agent 是角色配置，不是一次发言。
- Agent 不直接修改房间或游戏状态。
- Agent 的行为通过 Orchestrator 和 Provider 产生。

## Message

表示房间消息。

核心字段：

- `id`
- `roomId`
- `senderKind`: `human`、`ai`、`system`
- `senderId`
- `type`: `text`、`event`、`vote`、`action`
- `content`
- `status`: `pending`、`streaming`、`completed`、`failed`
- `seq`
- `metadata`
- `createdAt`

规则：

- `seq` 在同一房间内递增。
- 页面消息排序以 `seq` 为准。
- 系统事件可以生成 Message，但权威事件仍写入 RoomEvent。

## RoomEvent

表示房间事件日志。

核心字段：

- `id`
- `roomId`
- `seq`
- `type`
- `actorId`
- `payload`
- `createdAt`

规则：

- `seq` 在同一房间内递增。
- 客户端重连时可通过 `lastSeq` 获取缺失事件。
- 事件 payload 必须可序列化。

## DiscussionTask

表示一次讨论任务。

核心字段：

- `id`
- `roomId`
- `title`
- `prompt`
- `status`: `queued`、`running`、`paused`、`completed`、`failed`
- `strategy`: `roundRobin`、`hostControlled`
- `createdAt`

规则：

- 首个版本只实现 `roundRobin`。
- DiscussionTask 不保存完整上下文，只引用房间消息和事件。

## GameSession

表示一个游戏会话。

核心字段：

- `id`
- `roomId`
- `gameType`
- `phase`
- `status`
- `state`
- `createdAt`

规则：

- `state` 可用 JSON 保存不同游戏的扩展状态。
- Rule Engine 是 GameSession 状态的唯一修改入口。

## GamePlayerState

表示游戏中某个参与者的状态。

核心字段：

- `gameSessionId`
- `participantId`
- `role`
- `alive`
- `publicState`
- `privateState`

规则：

- `privateState` 不广播给所有客户端。
- AI 可见信息必须由 Context Manager 根据权限过滤。