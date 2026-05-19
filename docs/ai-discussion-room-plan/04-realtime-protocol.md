# 实时协议

## 协议原则

实时协议只传递房间事件和客户端命令。服务端是权威状态来源，客户端不直接决定 AI 发言结果、游戏阶段或成员状态。

## HTTP 职责

HTTP 用于请求响应式操作：

- 创建房间。
- 查询房间详情。
- 查询历史消息。
- 添加 AI 角色。
- 创建讨论任务。
- 启动或停止讨论。
- 查询游戏状态快照。

## WebSocket 职责

WebSocket 用于实时同步：

- 加入房间。
- 离开房间。
- 广播用户消息。
- 广播 AI 状态。
- 广播 AI 消息。
- 广播成员在线状态。
- 广播游戏阶段、投票和行动结果。

## 事件格式

所有服务端推送事件使用统一结构：

```json
{
  "id": "event-id",
  "roomId": "room-id",
  "seq": 12,
  "type": "message.created",
  "actorId": "participant-id",
  "payload": {},
  "createdAt": "2026-05-19T00:00:00.000Z"
}
```

字段说明：

- `id`：事件唯一标识。
- `roomId`：所属房间。
- `seq`：房间内递增序号。
- `type`：事件类型。
- `actorId`：触发事件的参与者；系统事件可为空。
- `payload`：事件数据。
- `createdAt`：服务端生成时间。

## 客户端命令

客户端通过 WebSocket 发送命令。命令不是事件，只有服务端接受并处理后才产生事件。

```json
{
  "roomId": "room-id",
  "type": "message.send",
  "payload": {
    "content": "请开始讨论这个方案"
  }
}
```

首批命令：

- `room.join`
- `room.leave`
- `message.send`
- `discussion.start`
- `discussion.pause`
- `game.action`
- `game.vote`

## 首批事件

- `room.joined`
- `room.left`
- `participant.updated`
- `message.created`
- `agent.thinking`
- `agent.speaking`
- `agent.failed`
- `discussion.started`
- `discussion.completed`
- `game.phaseChanged`
- `game.actionAccepted`
- `game.actionRejected`

## 重连策略

客户端保存最后收到的 `seq`。重连后客户端提交 `lastSeq`，服务端返回缺失事件。

流程：

1. 客户端断线前最后收到 `seq = 20`。
2. 客户端重连并发送 `room.join`，携带 `lastSeq = 20`。
3. 服务端查询 `seq > 20` 的 RoomEvent。
4. 服务端按顺序补发事件。
5. 客户端恢复实时监听。

## 顺序与幂等

- 同一房间内事件必须按 `seq` 顺序处理。
- 客户端收到重复 `seq` 时应忽略。
- 客户端发现 `seq` 不连续时应请求补事件。
- 服务端生成事件后再广播，避免广播成功但持久化失败。

## 错误事件

服务端拒绝命令时返回错误响应，不写入 RoomEvent。只有对房间状态有意义的失败才写入事件，例如 AI 调用失败。

错误响应结构：

```json
{
  "type": "error",
  "code": "invalid_room_state",
  "message": "Discussion is not running."
}
```

## 安全边界

- 客户端不能直接发送 `message.created` 等服务端事件。
- 游戏私有状态不进入公共广播事件。
- AI 可见上下文由服务端生成，不能由客户端传入。
- 所有命令都需要校验参与者是否属于当前房间。