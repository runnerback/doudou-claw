# QClaw

飞书机器人助手，部署在 ECS 24/7 运行。MVP 阶段支持消息互动（echo），后续按需求接入任务推送、LLM。

线上地址：https://claw.runfast.xyz（DNS 生效后）

## 快速开始

```bash
# 后端
cd server && npm install && npm run dev    # :13100

# 前端（另一个终端）
cd client && npm install && npm run dev    # :13101
```

打开 http://localhost:13101 看管理面板。

## 测试 bot 消息互动

1. 编辑 `server/.env`，临时设 `ENABLE_BOT=true`
2. 重启后端，应看到 `[bot] WebSocket 长连接已启动`
3. 在飞书把机器人拉进群，@机器人 发消息
4. 应收到 `[QClaw echo] xxx`
5. 测完改回 `ENABLE_BOT=false`

## 项目文档

- [CLAUDE.md](CLAUDE.md) — 完整项目说明
- [docs/bot-socket/README.md](docs/bot-socket/README.md) — 长连接架构
- [docs/deployment/README.md](docs/deployment/README.md) — ECS 部署流程

## 部署

详见 [docs/deployment/README.md](docs/deployment/README.md)。
