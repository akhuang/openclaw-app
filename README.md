# OpenClaw 内网部署

华为内网一键部署 OpenClaw，对接小鲁班 + 供应链查询。

当前仓库内置的 OpenClaw 版本以 `openclaw.version` 为准；启动脚本和安装脚本会统一读取该文件。

Welink 宿主接入的完整步骤见：
[docs/welink-supply-openclaw-bot.md](docs/welink-supply-openclaw-bot.md)

## 目录结构

```
openclaw-app/
├── run.bat                  # 一键启动 (双击即用)
├── bin/
│   ├── node.exe             # Node.js 22.x portable
│   └── npm.cmd              # npm portable
├── pkg/
│   └── openclaw-<版本号>.tgz
├── runtime/
│   └── npm-global/          # 本地 openclaw CLI 安装目录
├── data/
│   ├── .openclaw/           # OpenClaw 状态目录（配置/会话/日志）
│   └── workspace/           # OpenClaw 工作区
├── script/
│   ├── launcher.js          # 启动器 (配置/注册/代理)
│   ├── openclaw.json        # 配置模板 (必须)
│   └── openclaw.example.json # 配置模板示例
├── skills/
│   ├── intranet-analyzer/   # 通用内网页面截图分析
│   └── supply-query/        # W3 供应链合同批次查询
└── build/
    ├── .npmrc               # 编译用配置
    └── README.md            # 编译指南
```

## 快速开始

### 1. 准备环境

```
1) 确认 bin/ 目录存在，并包含 node.exe / npm.cmd
2) 准备与 openclaw.version 对应版本的 tgz 包，放入 pkg/，文件名保持 openclaw-<版本号>.tgz
3) 复制 script/openclaw.example.json 为 script/openclaw.json，修改配置
```

正式分发包默认已经预置 `bin/`，不依赖系统 Node.js / npm。
启动脚本会把 `OPENCLAW_STATE_DIR`、`OPENCLAW_CONFIG_PATH`、`OPENCLAW_WORKSPACE_DIR`
都指向当前目录下的 `data/`，不会写入用户主目录中的默认状态目录。

### 2. 配置模板

```bat
copy script\openclaw.example.json script\openclaw.json
```

必须修改的项：

| 配置项 | 说明 |
|--------|------|
| `models.providers.xlb.baseUrl` | 内网 LLM 服务地址 |
| `models.providers.xlb.apiKey` | 留 `xxx` 则自动替换为 whoami |
| `agents.defaults.model` | 默认模型，如 `xlb/deepseek-r1` |

### 3. 启动

双击 `run.bat`，自动完成：
- 复用本地 `bin\node.exe` / `bin\npm.cmd`
- 从 `pkg/openclaw-<版本>.tgz` 安装到 `runtime\npm-global\`
- 读取模板生成 `data\.openclaw\openclaw.json`（保留已有 Token）
- 向小鲁班注册
- 启动 OpenClaw Gateway (端口 18789)
- 启动 IP 白名单代理 (端口 18889)
- 打开浏览器

## 配置模板说明

`script/openclaw.json` 是配置模板。每次启动时 launcher.js 会：
1. 读取模板
2. 从旧配置提取 Token（首次运行自动生成）
3. 注入 Token、端口、apiKey、browser、skills 路径
4. **完全覆盖**写入 `data\.openclaw\openclaw.json`（覆盖前自动备份 .bak）

### 完整配置示例

```json
{
  "gateway": {
    "bind": "loopback",
    "port": 18789,
    "tailscale": { "mode": "disabled" },
    "auth": { "allowTailscale": false }
  },
  "browser": {
    "enabled": true,
    "defaultProfile": "user",
    "profiles": {
      "user": {
        "driver": "existing-session",
        "attachOnly": true,
        "color": "#00AA00"
      }
    }
  },
  "channels": {
    "telegram": { "enabled": false },
    "discord": { "enabled": false },
    "whatsapp": { "enabled": false },
    "slack": { "enabled": false },
    "signal": { "enabled": false },
    "teams": { "enabled": false }
  },
  "models": {
    "providers": {
      "xlb": {
        "baseUrl": "http://xiaoluban.rnd.huawei.com/v1",
        "apiKey": "xxx",
        "api": "openai-completions",
        "models": [
          { "id": "deepseek-r1", "name": "DeepSeek R1" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "xlb/deepseek-r1"
    }
  }
}
```

### browser profile 配置

OpenClaw 支持三种浏览器连接方式 (driver)：

| driver | 连接方式 | 需要 cdpPort/cdpUrl | 是否需要重启 Chrome |
|--------|----------|-------------------|-------------------|
| `existing-session` | Chrome MCP 自动连接 | **不需要** | **不需要** |
| `openclaw` | CDP 端口连接 | **需要** | 需要带 `--remote-debugging-port` 启动 |
| `extension` | Chrome 扩展连接 | **需要** | 不需要 |

#### 推荐方案：existing-session

自动连接用户已运行的 Chrome，无需重启、无需 CDP 端口、无需 Chrome 扩展。

```json
"browser": {
  "enabled": true,
  "defaultProfile": "user",
  "profiles": {
    "user": {
      "driver": "existing-session",
      "attachOnly": true,
      "color": "#00AA00"
    }
  }
}
```

> 注意：当前仓库内置版本已经包含 `existing-session` 的配置校验修复；如果你手动降级到较旧版本，仍可能报错。

#### 备选方案：openclaw + CDP

如果 `existing-session` 不可用：

```json
"profiles": {
  "user": {
    "driver": "openclaw",
    "cdpPort": 9222,
    "attachOnly": true,
    "color": "#00AA00"
  }
}
```

需要用特殊参数启动 Chrome：
```bat
chrome.exe --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1
```

#### profile 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `driver` | string | `"existing-session"` / `"openclaw"` / `"extension"` |
| `color` | string | **必填**，6位 hex 颜色如 `"#00AA00"` |
| `attachOnly` | boolean | `true` = 只连接不启动浏览器 |
| `cdpPort` | number | CDP 端口，`openclaw`/`extension` driver 必填 |
| `cdpUrl` | string | CDP URL，替代 cdpPort |

可用颜色：`#FF4500` `#0066CC` `#00AA00` `#9933FF` `#FF6699` `#00CCCC` `#FF9900`

## Skills

### intranet-analyzer（通用内网截图分析）

复用 Chrome 登录态，截图任意内网页面并分析内容。

```
你: "帮我看一下 http://10.0.1.50:3000/dashboard"
```

### supply-query（W3 供应链查询）

在 W3 供应链系统中查询合同批次，提取原合同号、批次号、RPD、CPD。

```
你: "查一下合同 1Y0123456 的批次信息"
你: "查一下这几个合同 1Y0111111 1Y0222222"
```

## 安全说明

| 措施 | 说明 |
|------|------|
| Gateway 绑定 loopback | 仅本机可访问 18789 端口 |
| 关闭所有消息通道 | Telegram/Discord/WhatsApp 等全部禁用 |
| 禁用 Tailscale | 无远程访问入口 |
| IP 白名单代理 | 18889 端口仅允许指定 IP（小鲁班）访问 |
| Token 认证 | Gateway 访问需要 Token |
| LLM 指向内网 | 不调用外网 API |

### 注意事项

- **Token 存储**：`data/.openclaw/openclaw.json` 中 Token 为明文，确保当前目录权限受控
- **注册走 HTTP**：小鲁班注册请求为明文传输，Token 和 whoami 在内网裸传

## launcher.js 功能

| 功能 | 说明 |
|------|------|
| 端口冲突检测 | 启动前检测 18789/18889 是否被占用 |
| 端口就绪等待 | 轮询等待 OpenClaw 就绪后再启动代理 |
| 崩溃自动重启 | 最多重试 3 次，带冷却期 |
| 注册超时 | 10s 超时，不阻塞启动 |
| 配置备份 | 覆盖前自动备份 openclaw.json.bak |
| 日志时间戳 | 所有日志带 [HH:MM:SS] |
