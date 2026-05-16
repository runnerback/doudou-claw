# QClaw 飞书机器人助手

> 飞书机器人 + 任务推送 + 业务集成，部署在 ECS 24/7 运行，**替代"电脑必须开机"的桌面助手方案**。

## 项目定位

最初想用腾讯 QClaw 桌面应用实现"微信遥控电脑"，但 QClaw 不支持 Linux/服务器 → 改用**飞书开放平台机器人 + WebSocket 长连接 + ECS 自托管**方案。项目代号沿用 QClaw。

## 当前进度

- [x] 项目骨架（server + client）
- [x] WebSocket 长连接接收消息
- [x] echo 回复 + /help 命令（验证消息互动）
- [x] Bot 群路由管理 API + 前端
- [x] 业务 H5 页面占位
- [ ] 任务获取（按 PRD 后续推进）
- [ ] 任务推送（定时 cron + 业务触发）
- [ ] LLM 智能回复

## 技术选型

| 层 | 技术 | 版本 |
|---|---|---|
| 后端运行时 | Node.js | 18+ |
| Web 框架 | Express | 5.x |
| 飞书 SDK | @larksuiteoapi/node-sdk | 1.x |
| 前端 | React + Vite + AntD + TS | 19 / 7 / 6 / 5.9 |
| 路由 | react-router-dom | 7.x |
| 数据存储 | JSON 文件（MVP 阶段） | - |
| 部署 | PM2 + Nginx + Let's Encrypt | - |

## 项目结构

```
QClaw/
├── _PRD/                            # 产品需求
│   └── 01QClaw.md
├── server/                          # 后端
│   ├── src/
│   │   ├── index.js                 # Express 入口（启动 HTTP + bot）
│   │   ├── bot/
│   │   │   ├── index.js             # WebSocket 长连接 + 事件分发
│   │   │   └── handlers/echo.js     # MVP echo handler
│   │   ├── routes/
│   │   │   ├── health.js            # /api/health
│   │   │   └── botRoutes.js         # /api/bot/routes CRUD
│   │   └── utils/chatStore.js       # JSON 存储（接触过的群/私聊）
│   ├── config/                      # 静态配置
│   ├── data/                        # 运行时数据（rsync 排除）
│   ├── ecosystem.config.js          # PM2 配置
│   ├── package.json
│   ├── .env                         # 本地 dev（gitignore，含真实凭证）
│   ├── .env.production              # 生产模板（gitignore，含真实凭证）
│   └── .env.example                 # 公开模板（committed）
├── client/                          # 前端
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                  # Layout + 顶部导航
│   │   ├── api/index.ts             # 统一 fetch 封装
│   │   └── pages/
│   │       ├── Home.tsx             # 服务状态
│   │       ├── BotManage.tsx        # 群路由管理
│   │       └── H5.tsx               # 业务 H5（占位）
│   ├── vite.config.ts               # dev :13101，proxy /api → :13100
│   ├── tsconfig.json
│   ├── package.json
│   ├── .env.development             # VITE_API_BASE 空（用 proxy）
│   └── .env.production              # VITE_API_BASE 空（nginx 同源）
├── docs/
│   ├── bot-socket/README.md         # 长连接架构 + 飞书平台配置
│   └── deployment/README.md         # ECS 部署流程
├── CLAUDE.md
├── README.md
└── .gitignore
```

## 关键事实

| 项 | 值 |
|---|---|
| 飞书 App ID | `cli_aa829e88c4395bd4` |
| ECS | 115.190.207.149（与 feishu-tool 共用） |
| 域名 | `claw.runfast.xyz`（A 记录待 DNS 生效） |
| ECS 路径 | `/var/www/claw/{server,client/dist}` |
| PM2 服务名 | `claw-api` |
| 后端端口 | 13100（避开 feishu-tool 的 13000） |
| 前端 dev 端口 | 13101 |

## 开发命令

```bash
# 后端（端口 13100）
cd server
npm install
npm run dev

# 前端（端口 13101，proxy /api → :13100）
cd client
npm install
npm run dev
```

## 本地测试 bot 消息互动

```bash
# 1. 临时打开本地 bot
# 编辑 server/.env：ENABLE_BOT=true
cd server && npm run dev
# 应看到：[bot] WebSocket 长连接已启动

# 2. 在飞书把机器人拉进群（或私聊），@它发任何文本
#    应收到：[QClaw echo] xxx

# 3. 测完关闭本地 bot
# 编辑 server/.env：ENABLE_BOT=false
#（避免与 ECS 部署后抢同一个 App 的长连接，导致消息重复处理）
```

## 部署

详见 [docs/deployment/README.md](docs/deployment/README.md)。

**简版**：
```bash
# 前端构建 + 上传
cd client && npm run build
rsync -avz --delete dist/ root@115.190.207.149:/var/www/claw/client/dist/

# 后端上传 + 重启
cd ../server
rsync -avz --delete --exclude='node_modules' --exclude='.env' \
  --exclude='.env.production' --exclude='data' \
  ./ root@115.190.207.149:/var/www/claw/server/
ssh root@115.190.207.149 "cd /var/www/claw/server && npm install --production && pm2 reload ecosystem.config.js"
```

## 与 feishu_docs 的关系

- **同 ECS、不同项目**：路径独立 `/var/www/claw/` vs `/var/www/feishu-tool/`，PM2 服务独立 `claw-api` vs `feishu-tool-api`
- **同设计模式**：WebSocket 长连接、`ENABLE_BOT` 开关、PM2 + Nginx + Let's Encrypt
- **代码不混淆**：不共享 npm 包、不共享配置文件、不共享 git 仓库

## ⚠️ 安全提醒

App Secret 已在 `_PRD/01QClaw.md` 明文出现（`7OmYAtGZyoPlOrcpo2kFNd4JFJUS8amn`）。强烈建议：
1. 飞书开放平台 → 凭证 → **重新生成 App Secret**
2. 新 Secret 仅放 `.env` / `.env.production`（已 gitignored）
3. 从 `_PRD/01QClaw.md` 删除明文 Secret 行

## 重要规则

- **不在 ECS 上 build**：1.9GB 内存不够，本地构建后 rsync `dist/`（参考 MEMORY.md）
- **本地与 ECS 不同时启 bot**：同一个飞书 App 多端连接会消息重复
- **`.env*` 全部 gitignored**：仅 `.env.example` 提交作为模板
