# 内网编译 OpenClaw (v2026.3.13)

## 前置条件

- Node.js >= 22.16.0
- pnpm (`npm install -g pnpm`)
- Git for Windows（build 脚本用了 shell，需要 Git Bash）

## 编译步骤

### 1. 克隆指定版本

```bat
git clone --branch v2026.3.13-1 --depth 1 https://github.com/openclaw/openclaw.git
cd openclaw
```

### 2. 复制内网编译配置

```bat
copy ..\openclaw-app\build\.npmrc .
```

核心配置是 `optional=false`，跳过 node-llama-cpp 等重型 optional 依赖。

### 3. 安装依赖

```bat
set NODE_OPTIONS=--max-old-space-size=16384
pnpm install --no-optional
```

如果还报 heap out of memory：

```bat
pnpm install --no-optional --ignore-scripts
pnpm rebuild
```

### 4. 编译

build 脚本包含 shell 脚本 (`scripts/bundle-a2ui.sh`)，Windows 需要用 Git Bash：

```bat
set NODE_OPTIONS=--max-old-space-size=16384
"C:\Program Files\Git\bin\bash.exe" -c "pnpm build"
```

### 5. 打包

```bat
pnpm pack
```

生成 `openclaw-2026.3.13.tgz`。

### 6. 部署到 app/

```bat
cd ..\openclaw-app\app
npm init -y
npm install ..\openclaw\openclaw-2026.3.13.tgz --force
```

验证入口文件存在：

```bat
dir node_modules\openclaw\openclaw.mjs
```

### 更新已有部署

```bat
cd openclaw-app\app
npm install ..\openclaw\openclaw-2026.3.13.tgz --force
```

## 常见问题

| 问题 | 解决 |
|------|------|
| heap out of memory | `set NODE_OPTIONS=--max-old-space-size=16384` |
| node-llama-cpp 安装失败 | `pnpm install --no-optional` |
| build 时 module not found node-llama-cpp | 见下方"创建空壳模块" |
| `bundle-a2ui.sh` 无法执行 | 用 Git Bash: `"C:\Program Files\Git\bin\bash.exe" -c "pnpm build"` |
| npm registry 不可达 | `.npmrc` 加 `registry=https://内网镜像地址` |
| native addon 编译失败 | 安装 Visual Studio Build Tools (C++ 桌面开发) |
| playwright 浏览器下载失败 | `set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` |

### 创建 node-llama-cpp 空壳模块

如果 `pnpm build` 报 `module not found: node-llama-cpp`：

```bat
mkdir node_modules\node-llama-cpp
echo {"name":"node-llama-cpp","version":"3.16.2","main":"index.js"} > node_modules\node-llama-cpp\package.json
echo module.exports = new Proxy({}, { get: () => () => { throw new Error('node-llama-cpp not available'); } }); > node_modules\node-llama-cpp\index.js
```

然后重新 `pnpm build`。

## 可安全跳过的重型依赖

内网对接小鲁班 API 不需要本地推理，以下 optional 依赖可以跳过：

| 包名 | 用途 | 为什么不需要 |
|------|------|-------------|
| `node-llama-cpp` | 本地 LLM 推理 | 用小鲁班 API |
| `@napi-rs/canvas` | Canvas 渲染 | 非核心功能 |
| `@matrix-org/matrix-sdk-crypto-nodejs` | Matrix 加密 | 不用 Matrix 通道 |
| `authenticate-pam` | PAM 认证 | Windows 不支持 |
| `@whiskeysockets/baileys` | WhatsApp | 内网不用 |
