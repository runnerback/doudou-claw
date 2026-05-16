# 飞书机器人长连接

> 用 `@larksuiteoapi/node-sdk` 的 WebSocket 长连接接收消息，无需公网 webhook。

## 架构

```
飞书服务器
    ↕  WebSocket（出站，SDK 自带自动重连）
ECS claw-api（process.env.ENABLE_BOT === 'true'）
    ↓
src/bot/index.js  (Lark.WSClient + Lark.EventDispatcher)
    ↓
src/bot/handlers/echo.js  ←—— MVP echo
    ↓
client.im.v1.message.reply（回复消息）
```

## 关键代码

`server/src/bot/index.js`：

```javascript
const Lark = require('@larksuiteoapi/node-sdk')

const client = new Lark.Client({ appId, appSecret })
const wsClient = new Lark.WSClient({ appId, appSecret, loggerLevel: Lark.LoggerLevel.info })

const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    // 1. 消息去重（缓存最近 200 条 message_id）
    // 2. 学习 chat_id 到 chatStore
    // 3. 调用 handler（当前只有 echo）
  },
  'im.chat.member.bot.added_v1': async (data) => {
    // 机器人入群事件 → 登记 chat_id
  },
})

wsClient.start({ eventDispatcher })
```

## 飞书开放平台配置（必须）

1. **机器人能力** → 已开启（你创建 App 时勾选了）
2. **事件订阅 → 接收方式** → **使用长连接接收**
3. **事件订阅 → 订阅事件**：
   - `im.message.receive_v1` ✓ 必须
   - `im.chat.member.bot.added_v1` 建议（自动登记 chat_id）
4. **权限**：
   - `im:message` ✓ 必须（接收消息）
   - `im:message:send_as_bot` ✓ 必须（以 bot 身份回复）
   - `im:chat:readonly` 建议（获取群名）
5. **版本管理** → 创建版本 → 提交审核 → 发布
   - 个人开发者应用，企业内自用通常审核较快

## 本地 vs ECS

| 环境 | `ENABLE_BOT` | 说明 |
|---|---|---|
| 本地 dev 默认 | `false` | 不启动 bot，仅 HTTP API 可用 |
| 本地调试 bot | 临时 `true` | 测完改回 false |
| ECS 生产 | `true` | 24/7 长连接独占 |

**同一个飞书 App 不能多端同时连接**，否则消息会被多次处理。

## 消息流测试

### 场景 1：群聊 echo

1. 把机器人拉进群
2. 群里 @机器人 hello
3. 期望：`[QClaw echo] hello`

### 场景 2：群聊帮助

1. 群里 @机器人 help
2. 期望：完整 help 文本（功能列表）

### 场景 3：私聊 echo

1. 私聊机器人发 `test`
2. 期望：`[QClaw echo] test`（私聊不需要 @）

## SDK 行为要点

- **自动重连**：网络抖动后 WSClient 自动恢复，无需手动处理
- **消息去重**：飞书可能重复推送（网络问题），代码侧用 `processedMessages` Set 缓存最近 200 条 `message_id`
- **群聊默认不响应**：必须 `mentions` 里有 user_id 为 `''` 的项（机器人自己）才响应
- **私聊全响应**：`chat_type === 'p2p'` 时无需 @

## Handler 扩展模式

新增功能时在 `src/bot/handlers/` 加文件，导出 `async function (client, data) {}`，然后在 `src/bot/index.js` 的事件分发里按 chat_id 或文本前缀路由。

参考 feishu_docs 的成熟模式：路由配置 JSON + handler 映射。MVP 阶段直接 echo，不引入路由复杂度。

## 后续扩展（不在 MVP 范围）

- [ ] /help 卡片化（飞书 interactive card）
- [ ] 任务推送（定时 cron → 推到指定 chat_id）
- [ ] 任务获取（用户 @bot 列出待办）
- [ ] LLM 智能回复（接 DeepSeek 等）
