# 订单履行运营员(fulfillment-operator)落地方案

> 状态:**定稿**(2026-06-10)。Phase 1 开工基线。
> 上游数据项目:clipq(战地哨兵,`~/Programming/GitHub/clipq`)。

## 一、目标与定位

让 OpenClaw 成为本业务**唯一的 agent 层**(clipq 的 pi-agent 不启用):

> **订单履行异常运营员**:读取 ClipQ 数据,发现动作机会,整理通知,生成邮件/进展/待办草稿,追踪承诺,学习偏好。

纲领:**ClipQ 提供事实和确定性规则,OpenClaw 把事实变成可审阅的下一步;agent 只起草、只建议,确认动作永远在人。**

## 二、全局架构

```
触点层   Welink IM ←→ OpenClaw agent(fulfillment-operator)
                         │ exec → script/clipq-query.js(全部 127.0.0.1,不出网)
服务层   clipq workspace-server :17321(唯一业务 API,localhost 免鉴权)
            └ 降级 → PostgreSQL supply_db :5433(Docker 常驻,只读直连)
数据层   contract_batches(批次快照)+ workspace_batch_change_events(变更事件 P0–P3)
生产层   supply-connector(报表/导入/抓取)+ Outlook/剪贴板采集 + ingest 差异引擎(clipq 负责)
实时兜底 OpenClaw browser → W3(已有 supply-query skill)
```

### 数据通路(已拍板:API + PG)

统一封装在 `script/clipq-query.js`,skill 不碰裸 curl/SQL:

1. 优先 API `http://127.0.0.1:17321`(3s 超时)
2. 失败回退 PG 直连(`CLIPQ_PG_*` 走 `.env`,默认 `127.0.0.1:5433/supply_db/supply_user`,密码不进 git)
3. 都失败输出结构化错误(给 agent 降级话术)

两条通路输出同构 camelCase JSON + `_source: "api"|"pg"` + 数据时点。PG 路径只读、SQL 固定在脚本里。
依赖 `pg`(纯 JS)vendor 进 repo(离线部署机无法 npm install)。

## 三、OpenClaw 机制映射

| 机制 | 用法 |
|---|---|
| `agents.list[]` | 专职 agent:`{id: fulfillment-operator, default: true, workspace: data/workspaces/fulfillment-operator, skills: [业务技能子集]}` |
| `bindings[]` | Welink 全量路由 → fulfillment-operator |
| `agents.defaults.skills` | 全局白名单照旧兜底(launcher 扫 repo skills/ 动态生成,新 skill 自动收录) |
| Workspace bootstrap | `AGENTS.md`(宪法,常驻注入)、`HEARTBEAT.md`(巡检清单);launcher 每次启动从模板**强制覆盖**下发 |
| Heartbeat | Phase 1 静默(HEARTBEAT.md 纯注释);Phase 2 在 agent 条目上开(every/activeHours/target=welink) |
| Skills | repo `skills/` 下,description 触发按需加载 |

## 四、关键设计决策(含对外部建议稿的六处落地化纠正)

1. **skills 不放 workspace**:workspace/skills 已被安全策略禁用(agent 可写区不放可执行物)。业务 skills 一律放 repo `skills/`,"workspace 归属"用 per-agent `skills` 白名单实现。
2. **skill 不带自定义 tool**:OpenClaw skill 无 tool 注册机制。确定性工具 = `script/*.js`(repo 只读区),SKILL.md 指挥 agent 用 exec 调用。
3. **安全不做成 skill**(skill 靠 description 触发,不触发就不生效)。拆三层:
   - 禁止事项 → `AGENTS.md`(每会话常驻注入)
   - 工具硬限制 → `agents.list[].tools` allow/deny(launcher 注入,模型绕不过)
   - 出口管控 → 已有体系(模型 baseUrl 白名单 / browser SSRF 白名单 / skills 白名单)
   - 审计 → `state/run_history.jsonl`
4. **结构化靠脚本不靠 schema 强制**:recipe 引擎输出天然结构化 JSON,LLM 只消费事实不生产事实;LLM 产物(email_plan 等)用 SKILL.md 内嵌 JSON 模板约定。
5. **状态用 json/jsonl 不用 sqlite**:游标、机会快照、交互事件、preferences.yaml。量级够,需要查询再升级。
6. **交互面 = Welink 对话 + 文件,不造 UI**:机会卡片/确认/修改意见走 Welink;全文落 `reports/`、`drafts/`;偏好 proposal 以 Welink 消息征求确认。富编辑体验是 clipq 桌面应用的职责。

### 确定性 / 智能判断分界(AGENTS.md 宪法核心)

- **必须由 recipe/脚本/ClipQ 完成,模型不得自由判断**:找大调度、按大调度分组、算 GAP、判断已发货/齐套、渲染最终 HTML、通知已读/忽略、创建/关闭待办、创建监控。
- **模型负责**:归并多条通知是否同一事项、解释风险为何今天处理、生成邮件备注/进展草稿/跟进说明、抽取承诺、判断承诺是否被新进展覆盖、从用户修改中提出偏好建议。
- **禁止**:发邮件、写 ERP、承诺客户交期、改写 ClipQ 原始数据、删通知/待办/进展、自动改偏好、装第三方 skill。

## 五、仓库布局(目标态)

```
openclaw-app/
├── skills/                                  ← 白名单自动收录
│   ├── clipq-data/SKILL.md                    数据桥手册(调 clipq-query.js;事实唯一来源,缺数据标 missing 不脑补)
│   ├── fulfillment-opportunities/             SKILL.md + recipes/*.yaml(确定性动作机会)
│   ├── notification-triage/SKILL.md           通知归并(只建议,不直接已读/忽略)
│   ├── supply-query/                          (已有)W3 实时兜底
│   ├── intranet-analyzer/                     (已有)内网截图佐证
│   └── (Phase 2+)email-drafting / batch-investigation / commitment-tracker / preference-learning
├── script/
│   ├── clipq-query.js                         API 优先 + PG 兜底;子命令 health/batches/changes(+按需扩展)
│   ├── build-opportunities.js                 recipe 引擎:precondition/groupBy/GAP 全确定性
│   └── workspace-template/fulfillment-operator/
│       ├── AGENTS.md                          宪法(岗位+事实来源+确定性分界+禁止事项)
│       └── HEARTBEAT.md                       Phase 1 纯注释
└── data/workspaces/fulfillment-operator/    ← 运行时(gitignore),launcher 建骨架+下发模板
    ├── state/   机会快照、游标、interaction_events.jsonl、preferences.yaml、run_history.jsonl
    ├── reports/ 今日动作机会、晨报(markdown)
    └── drafts/  email_plan 与渲染产物
```

## 六、Recipes(首批 5 个,Phase 1 先做 2 个)

| recipe | 触发条件要点 | 动作 |
|---|---|---|
| `urge_dispatcher_pull_in` ★P1 | 实物批次、未发货、有大调度、EPD_A > CPD、当日无大调度回复进展 | 按大调度分组 → 邮件计划 |
| `followup_overdue` ★P1 | 承诺/待办逾期且其后无新进展 | 跟进草稿 |
| `urge_shipment` | 齐套可发、未发货、CPD ≤ 3 天 | 按发货责任人分组 → 邮件计划 |
| `sync_sales_risk` | EPD_A 晚于客户需求日期、近期未同步销售 | 风险同步草稿 |
| `create_watch` | 用户多次打开同批次、风险未关闭、无既有监控 | 建监控建议 |

机会输出结构(脚本产出,模型只补 reason/title 等解释字段):

```json
{
  "type": "action_opportunity",
  "kind": "urge_dispatcher_pull_in",
  "groups": [{ "dispatcher": "王工", "rows": [{ "contractNo": "…", "batchNo": "…", "cpd": "…", "epdA": "…", "gapDays": 6 }] }],
  "actions": ["generate_email", "snooze", "ignore"],
  "evidence": ["clipq:batches@<时点>"]
}
```

## 七、分期

| Phase | 内容 | 交付 |
|---|---|---|
| **1 只读洞察** | clipq-query.js(+vendor pg、.env.example)、build-opportunities.js(2 recipes)、三个 skill、AGENTS.md/HEARTBEAT.md 模板、launcher(agents.list + bindings + 多 workspace 下发)、测试 | Welink 说"早报" → 今日建议动作清单(分组/GAP/理由)落 reports/ 并回贴 |
| **2 邮件闭环** | email-drafting(单 recipe)、渲染通路(查证 clipq renderer,无则脚本渲染)、interaction_events 记 diff;heartbeat 启用(morning_pulse) | 生成→编辑→复制→记录 |
| **3 批次解释** | batch-investigation | 解释卡点、下一步找谁 |
| **4 承诺追踪** | commitment-tracker | 到期提醒、无进展催办、闭环 |
| 贯穿 | preference-learning:先只记事件(jsonl),积累后出 proposal,确认才写入 preferences.yaml | |

## 八、风险与待查证

- **clipq 进程依赖**:API 跟 Electron 应用走;PG 兜底解除硬依赖,但**数据新鲜度=最近一次导入**,agent 回答强制标注时点与来源。
- **待查证(Phase 2 前)**:clipq 是否有邮件 HTML 渲染 API(`render_email`);无则脚本渲染。
- **心跳 × 小鲁班配额**:工作时间每 30m 轻调用 + `skipWhenBusy`,可控。
- **PG 凭据**:进部署机 `.env`(已 gitignore);可选建 PG 只读账号收紧。
- **schema 演进**:PG 直读 SQL 集中在 clipq-query.js 一处,clipq 改表只对一个文件。
