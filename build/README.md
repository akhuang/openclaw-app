# 内网编译 OpenClaw

## 编译步骤

```bat
:: 1. 克隆源码
git clone https://github.com/openclaw/openclaw.git
cd openclaw

:: 2. 复制内网编译配置（跳过 node-llama-cpp 等重型依赖）
copy ..\build\.npmrc .

:: 3. 安装依赖
set NODE_OPTIONS=--max-old-space-size=16384
pnpm install

:: 4. 如果 pnpm install 还报 OOM，分两步走
pnpm install --ignore-scripts
pnpm rebuild

:: 5. 编译
pnpm build

:: 6. 把产物复制到 app 目录
xcopy /E /I . ..\app
```

## 如果 node-llama-cpp 还是被拉下来

在 openclaw 源码根目录的 `package.json` 中，找到 `peerDependencies` 下的 `node-llama-cpp`，直接删掉：

```diff
  "peerDependencies": {
-   "node-llama-cpp": "3.16.2",
    ...
  }
```

同时在 `peerDependenciesMeta` 中也删掉对应条目。

然后删掉 lock 文件重新装：

```bat
del pnpm-lock.yaml
pnpm install
```

## 可以安全删除的重型依赖

内网对接小鲁班不需要本地推理和大部分消息通道，以下依赖可以在 `package.json` 中移除：

| 包名 | 原因 |
|------|------|
| `node-llama-cpp` | 本地 LLM 推理，内网用 API 不需要 |
| `@napi-rs/canvas` | Canvas 渲染，非必要 |
| `@matrix-org/matrix-sdk-crypto-nodejs` | Matrix 协议加密 |
| `authenticate-pam` | PAM 认证，Windows 不用 |
| `@whiskeysockets/baileys` | WhatsApp 连接，内网不用 |

## 如果不想碰 package.json

在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 列表中，pnpm 会只用预构建二进制。
如果预构建二进制不存在（内网下不到），加一个 `.npmrc`：

```
optional=false
```

这样所有标记为 optional 的依赖都会被跳过。
