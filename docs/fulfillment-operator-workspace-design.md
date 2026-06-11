# Fulfillment Operator Workspace Design

结论：订单履行运营员不应该使用默认 workspace。它应该是 `agents.list[]` 里的专职 agent，并使用独立 workspace：`data/workspaces/fulfillment-operator`。

## 为什么不能用默认 workspace

默认 workspace 适合作为普通会话的 fallback，不适合作为订单履行业务 agent 的工作区。订单履行需要独立的上下文、状态、报告、草稿和审计记录。如果把它放到 `agents.defaults.workspace`，普通会话、个人请求、调试请求和供应链履行任务会混在一起。

## 正确分层

```text
openclaw-app/
  skills/                         # repo 白名单 skill 来源
  script/                         # 确定性脚本和 Bun/Node 执行入口
  config/                         # recipes 和默认配置
  script/workspace-template/       # 专职 agent workspace 模板
  data/workspaces/fulfillment-operator/
    AGENTS.md
    HEARTBEAT.md
    state/
    reports/
    drafts/
```

## 关键规则

- `skills/` 是能力说明来源。
- `script/` 是确定性执行来源。
- `data/workspaces/fulfillment-operator/` 是运行时状态和工作产物来源。
- runtime workspace 不放可执行 skill。
- runtime workspace 不作为工具注册来源。
- Welink 应该路由到 `fulfillment-operator` agent。
- `agents.defaults.workspace` 只做 fallback，不承载订单履行业务。

## Bun 的位置

Bun 可以用于执行 TypeScript 脚本，但这不等于 OpenClaw skill 会自动注册 `tools/*.ts`。

推荐方式：

```text
SKILL.md 指挥 agent 调用 script/clipq-run.js
clipq-run.js 优先使用 bin/bun.exe 执行 script/*.ts
没有 Bun 时回退到 Node 执行 script/*.js
```

所以准确边界是：

```text
可以：repo script/*.ts + Bun + wrapper
不应该：workspace/skills/tools/*.ts 当成 OpenClaw 原生 tool
```
