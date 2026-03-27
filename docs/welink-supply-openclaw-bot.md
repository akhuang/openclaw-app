# Welink 接入总指导

这份文档说明如何把下面三部分接起来：

- `openclaw-app`：OpenClaw 启动器和本地插件目录
- `extensions/welink`：OpenClaw 侧的 Welink channel
- `supply-openclaw-bot`：Welink 宿主插件适配层

目标链路：

```text
Welink
  -> main.py
  -> supply-openclaw-bot/plugin.py
  -> OpenClaw /webhook/welink/default
  -> OpenClaw welink channel
  -> http://127.0.0.1:18890/messages/send
  -> supply-openclaw-bot/callback_server.py
  -> send_msg()
  -> Welink
```

## 目录约定

本文默认使用下面两个目录：

- OpenClaw: `/Users/huangf/Programming/openclaw-app`
- 适配层: `/Users/huangf/Programming/GitHub/supply-openclaw/supply-openclaw-bot`

如果你换了目录，按实际路径替换即可。

## 当前状态

这两个本地文件已经生成好：

- OpenClaw 模板配置: `/Users/huangf/Programming/openclaw-app/script/openclaw.json`
- 适配层环境变量: `/Users/huangf/Programming/GitHub/supply-openclaw/supply-openclaw-bot/.env`

两边已经对齐了下面这组值：

- `accountId`: `default`
- `webhookPath`: `/webhook/welink/default`
- `callbackUrl`: `http://127.0.0.1:18890/messages/send`
- shared token:
  `e661d3c606e4988e6795f97d88c8c9b8f621d3c899b750b8`

## 一次性准备

### 1. 启动 OpenClaw

在 `openclaw-app` 目录执行：

```bash
./run.sh
```

或者在 Windows 双击：

```text
run.bat
```

说明：

- 启动器会读取 `script/openclaw.json`
- 首次运行会把配置写到 `data/.openclaw/openclaw.json`
- Gateway 默认监听 `127.0.0.1:18789`

### 2. 安装并启用 Welink 插件

在 `openclaw-app` 目录执行：

```bash
./runtime/npm-global/bin/openclaw plugins install --link ./extensions/welink
./runtime/npm-global/bin/openclaw plugins enable welink
```

Windows 对应命令是：

```bat
runtime\npm-global\openclaw.cmd plugins install --link .\extensions\welink
runtime\npm-global\openclaw.cmd plugins enable welink
```

正常情况下跑过一次启动器后，这两个命令入口之一就会存在：

- macOS / Linux: `runtime/npm-global/bin/openclaw`
- Windows: `runtime/npm-global/openclaw.cmd`

### 3. 准备适配层依赖

在 `supply-openclaw-bot` 目录执行：

```bash
pip install -r requirements.txt
```

当前只需要：

- `python-dotenv`

## 两边配置如何对应

### OpenClaw 侧

`script/openclaw.json` 里已经写好：

```json
{
  "channels": {
    "welink": {
      "enabled": true,
      "token": "e661d3c606e4988e6795f97d88c8c9b8f621d3c899b750b8",
      "callbackUrl": "http://127.0.0.1:18890/messages/send",
      "webhookPath": "/webhook/welink/default",
      "dmPolicy": "open"
    }
  }
}
```

这表示：

- OpenClaw 收消息入口是 `/webhook/welink/default`
- OpenClaw 回消息目标是 `http://127.0.0.1:18890/messages/send`

### 适配层侧

`supply-openclaw-bot/.env` 里已经写好：

```env
OPENCLAW_BASE=http://127.0.0.1:18789
OPENCLAW_WELINK_ACCOUNT_ID=default
OPENCLAW_WELINK_TOKEN=e661d3c606e4988e6795f97d88c8c9b8f621d3c899b750b8
OPENCLAW_WELINK_WEBHOOK_PATH=/webhook/welink/default
WELINK_CALLBACK_HOST=127.0.0.1
WELINK_CALLBACK_PORT=18890
WELINK_CALLBACK_PATH=/messages/send
```

这表示：

- `plugin.py` 会把宿主消息转发到 `http://127.0.0.1:18789/webhook/welink/default`
- `callback_server.py` 会本地监听 `127.0.0.1:18890/messages/send`

## 运行顺序

推荐顺序：

1. 先启动 OpenClaw
2. 确认 Welink 插件已经安装并启用
3. 再启动承载 `supply-openclaw-bot/plugin.py` 的宿主进程
4. 在 Welink 发一条测试消息

原因：

- `supply-openclaw-bot` 收到消息后会立即转发到 OpenClaw webhook
- 如果这时 OpenClaw 还没起来，用户会直接收到失败提示

## 消息流

### 入站

用户在 Welink 发：

```text
你好
```

宿主调用：

- `supply-openclaw-bot/plugin.py`

它会 POST 到：

```text
http://127.0.0.1:18789/webhook/welink/default
```

body：

```json
{
  "token": "shared-token",
  "sender": "<msg.receiver>",
  "text": "你好"
}
```

### 出站

OpenClaw `welink` channel 生成回复后，会 POST 到：

```text
http://127.0.0.1:18890/messages/send
```

body：

```json
{
  "receiver": "<原 sender>",
  "text": "OpenClaw 的回复"
}
```

`callback_server.py` 收到后会执行：

```python
send_msg(text, receiver)
```

## `/new` 如何工作

这套链路里，`/new` 不需要适配层自己特殊处理。

原因：

- `plugin.py` 会把正文原样转发到 OpenClaw
- `extensions/welink` 会把同一个 sender 路由到固定 session key
- OpenClaw 自己负责 `/new` 的 session reset

因此用户直接在 Welink 发：

```text
/new
```

即可。

## 验证方法

### 1. OpenClaw 侧验证

确认配置文件已经生成：

```bash
ls data/.openclaw/openclaw.json
```

确认 Welink 插件状态：

```bash
./runtime/npm-global/bin/openclaw plugins list
./runtime/npm-global/bin/openclaw plugins info welink
```

Windows 对应：

```bat
runtime\npm-global\openclaw.cmd plugins list
runtime\npm-global\openclaw.cmd plugins info welink
```

### 2. 适配层侧验证

在 `supply-openclaw-bot` 目录执行：

```bash
python -m pytest tests -q
python -m py_compile plugin.py openclaw_client.py callback_server.py bot_config.py
```

### 3. 联调验证

发一条 Welink 消息后，检查：

- OpenClaw 是否收到 webhook
- `supply-openclaw-bot/data/bot.log` 是否有转发日志
- 端口 `18890` 是否有回调请求

## 常见问题

### 1. OpenClaw 收不到消息

先检查：

- `OPENCLAW_BASE` 是否是 `http://127.0.0.1:18789`
- `OPENCLAW_WELINK_WEBHOOK_PATH` 是否是 `/webhook/welink/default`
- `OPENCLAW_WELINK_TOKEN` 是否和 OpenClaw 配置里的 `channels.welink.token` 完全一致

### 2. OpenClaw 能收到，但 Welink 收不到回复

先检查：

- `callbackUrl` 是否是 `http://127.0.0.1:18890/messages/send`
- 宿主进程是否已经加载了 `supply-openclaw-bot/plugin.py`
- callback server 是否已经在监听 `18890`

### 3. 启动器报找不到 `script/openclaw.json`

现在仓库里已经补了：

- `/Users/huangf/Programming/openclaw-app/script/openclaw.json`

如果之后被删了，直接从 `script/openclaw.example.json` 重新生成即可。

### 4. Gateway token 要不要填到 `.env`

当前这条 `welink` webhook 链路主要靠 body 里的 shared token。

`.env` 里的：

```env
OPENCLAW_GATEWAY_TOKEN=
```

可以先留空。

如果你后面确认本地 webhook 入口还要求 Gateway `Authorization`，再把
`data/.openclaw/openclaw.json` 里自动生成的 `gateway.auth.token` 填进去。

## 后续建议

如果这套链路确认稳定，下一步建议做两件事：

1. 给 `supply-openclaw-bot` 加一个更明确的运行日志，记录 webhook 转发和 callback 回发
2. 在 OpenClaw 启动器里补一条 `welink` 集成说明链接，避免每次都翻 README
