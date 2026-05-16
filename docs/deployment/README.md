# QClaw 部署指南

> ECS: 115.190.207.149 | 域名: claw.runfast.xyz | PM2: claw-api | 后端端口: 13100

## ECS 路径规划

| 项 | 路径 |
|---|---|
| 后端代码 | `/var/www/claw/server` |
| 前端静态 | `/var/www/claw/client/dist` |
| PM2 配置 | `/var/www/claw/server/ecosystem.config.js` |
| Nginx 站点 | `/etc/nginx/sites-enabled/claw.runfast.xyz.conf` |
| SSL 证书 | `/etc/letsencrypt/live/claw.runfast.xyz/`（certbot 管理） |
| 日志 | `/var/log/pm2/claw-api.{out,error}.log` + `/var/log/nginx/claw.runfast.xyz.{access,error}.log` |

## ⚠️ 部署铁律

**绝不在 ECS 上执行 `npm run build` / `tsc`** —— ECS 1.9GB 内存，build 会 OOM 杀死 sshd 导致失联。所有构建本地完成，rsync `dist/` 上传。详见 `~/.claude/projects/-Users-bbshark-Documents-WorkProject/memory/MEMORY.md`。

## 首次部署

### 1. 确认前置条件

```bash
# DNS 已生效
dig +short claw.runfast.xyz A   # 应返回 115.190.207.149

# ECS 已就绪
ssh root@115.190.207.149 'node -v && pm2 -v && nginx -v && certbot --version'
```

### 2. ECS 创建目录

```bash
ssh root@115.190.207.149 "mkdir -p /var/www/claw/{server,client/dist} /var/log/pm2"
```

### 3. 上传 .env.production 作为 ECS 的 .env

```bash
scp server/.env.production root@115.190.207.149:/var/www/claw/server/.env
```

### 4. 上传后端代码 + 安装依赖

```bash
cd server
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.env.production' \
  --exclude='data' \
  ./ root@115.190.207.149:/var/www/claw/server/

ssh root@115.190.207.149 "cd /var/www/claw/server && npm install --production"
```

### 5. 启动 PM2

```bash
ssh root@115.190.207.149 "cd /var/www/claw/server && pm2 start ecosystem.config.js && pm2 save"
ssh root@115.190.207.149 "pm2 logs claw-api --lines 20 --nostream"
# 期望：[server] QClaw API listening on :13100
#       [bot] WebSocket 长连接已启动（前提：飞书 App 已发布且订阅事件）
```

### 6. 本地构建前端 + 上传

```bash
cd ../client
npm install
npm run build
rsync -avz --delete dist/ root@115.190.207.149:/var/www/claw/client/dist/
```

### 7. 配置 Nginx（HTTP）

ECS 上创建 `/etc/nginx/sites-enabled/claw.runfast.xyz.conf`：

```nginx
server {
    listen 80;
    server_name claw.runfast.xyz;

    root /var/www/claw/client/dist;
    index index.html;

    access_log /var/log/nginx/claw.runfast.xyz.access.log;
    error_log /var/log/nginx/claw.runfast.xyz.error.log;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:13100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location ~* \.(jpg|jpeg|gif|png|css|js|ico|woff|woff2|ttf|svg)$ {
        access_log off;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location ~ /\. {
        deny all;
    }
}
```

reload：

```bash
ssh root@115.190.207.149 "nginx -t && systemctl reload nginx"
```

### 8. 申请 Let's Encrypt 证书（certbot 自动改写 nginx）

```bash
ssh root@115.190.207.149 "certbot --nginx -d claw.runfast.xyz --non-interactive --agree-tos -m <你的邮箱>"
```

certbot 会自动：
- 给上面那个 server block 加 `listen 443 ssl`
- 加 SSL 证书路径和 dhparam 配置
- 新建一个 80 → 443 的 redirect server block
- 设置 cron auto-renew

### 9. 验证

```bash
curl -sI https://claw.runfast.xyz/ | head -3
curl -s https://claw.runfast.xyz/api/health
# 期望：{"status":"ok","service":"qclaw-api","bot_enabled":true,...}
```

浏览器打开 https://claw.runfast.xyz/ → 看到 QClaw 助手页面。

## 日常增量部署

### 仅前端

```bash
cd client && npm run build
rsync -avz --delete dist/ root@115.190.207.149:/var/www/claw/client/dist/
```

### 仅后端

```bash
cd server
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.env.production' \
  --exclude='data' \
  ./ root@115.190.207.149:/var/www/claw/server/

ssh root@115.190.207.149 "cd /var/www/claw/server && npm install --production && pm2 reload claw-api"
```

### 全量

把上面两段顺序执行即可。

## 环境变量管理

| 文件 | 用途 | git 状态 |
|---|---|---|
| `server/.env` | 本地 dev（`ENABLE_BOT=false`） | gitignored |
| `server/.env.production` | 生产模板（`ENABLE_BOT=true`） | gitignored |
| `server/.env.example` | 公开模板（占位值） | committed |

**关键规则**：rsync 排除 `.env` 和 `.env.production`，避免本地误覆盖 ECS。新增环境变量时本地和 ECS 各自手动加。

## 飞书开放平台清单（部署完后必须确认）

代码到 ECS 后，bot 能否真正接收消息取决于飞书 App 配置：

- [ ] 应用能力 → 添加机器人 ✓
- [ ] 事件与回调 → 接收方式：**使用长连接接收** ✓
- [ ] 事件订阅 → 添加 `im.message.receive_v1` ✓
- [ ] 事件订阅 → 添加 `im.chat.member.bot.added_v1`（可选） ✓
- [ ] 权限管理 → `im:message` ✓
- [ ] 权限管理 → `im:message:send_as_bot` ✓
- [ ] 版本管理 → **创建版本并发布** ✓（不发布，事件订阅不生效）

## 验证清单

部署后逐项确认：

- [ ] `curl https://claw.runfast.xyz/` 返回 200 + 加载前端
- [ ] `curl https://claw.runfast.xyz/api/health` 返回 `bot_enabled: true`
- [ ] `pm2 list` 看到 `claw-api online`
- [ ] `pm2 logs claw-api` 有 `WebSocket 长连接已启动`
- [ ] 飞书私聊机器人发 `hello` → 收到 `[QClaw echo] hello`
- [ ] 飞书群里 @机器人 发 `help` → 收到 help 文本

## 常见问题

| 现象 | 排查 |
|---|---|
| 502 Bad Gateway | `pm2 list` 看 `claw-api`；`pm2 logs claw-api` 看具体报错 |
| Bot 不响应消息 | (a) `.env` 里 `ENABLE_BOT=true`？(b) 飞书 App 是否已发布版本？(c) 事件订阅是否包含 `im.message.receive_v1`？(d) `pm2 logs` 是否有 `WebSocket 长连接已启动`？ |
| 证书申请失败 | `certbot certificates` 检查；80 端口要可达；DNS 必须生效 |
| 本地与 ECS bot 都响应（消息重复） | 本地 `.env` 改回 `ENABLE_BOT=false`，重启本地 |
| 内存不足 | `free -h` 看 ECS 当前内存；其他 PM2 服务是否吃满 |

## 与 feishu-tool 共存

| 资源 | feishu-tool | qclaw |
|---|---|---|
| ECS 路径 | `/var/www/feishu-tool/` | `/var/www/claw/` |
| PM2 服务 | `feishu-tool-api` | `claw-api` |
| 后端端口 | 13000 | 13100 |
| 域名 | feishu-tool.runfast.xyz | claw.runfast.xyz |
| Nginx 站点 | `feishu-tool.runfast.xyz.conf` | `claw.runfast.xyz.conf` |
| 飞书 App | `cli_a939d2dd0cb89bcd` (GRI) | `cli_aa829e88c4395bd4` (QClaw) |

互不干扰，可独立部署和重启。
