---
name: supply-query
description: "在华为 W3 供应链系统中查询合同批次信息。用户输入合同号后，自动导航到供应链工作台页面，填入合同号查询，截图结果页面，并提取原合同号、批次号、RPD、CPD 等关键列。当用户提到查合同、查批次、查供应链、查 RPD/CPD 时触发。"
metadata: { "openclaw": { "emoji": "📦", "requires": { "config": ["browser.enabled"] } } }
---

# 供应链合同批次查询

你是一个帮助用户在华为 W3 供应链系统中查询合同批次信息的技能。通过复用用户已登录的 Chrome 浏览器，自动完成查询操作并提取关键数据。

## 重要规则

- 始终使用 **`user`** 浏览器 profile，复用用户已登录的 Chrome 会话。
- **绝对不要**使用 `openclaw` profile。
- 页面基于 Webix 框架构建，元素交互需要特殊处理。

## 目标页面

供应链工作台地址：
```
https://w3.huawei.com/iscp/portal/#!/portal/iscp.oss.index/iscp.oss.fcworkstationapp.indexV2/iscp.oss.fcworkstationapp.subview.ossAll
```

## 完整工作流程

### 第一步：连接浏览器并导航

```
browser action=tabs profile=user
```

检查是否已有 W3 供应链页面打开。如果有，直接切换到该标签页；如果没有，新开一个：

```
browser action=navigate url="https://w3.huawei.com/iscp/portal/#!/portal/iscp.oss.index/iscp.oss.fcworkstationapp.indexV2/iscp.oss.fcworkstationapp.subview.ossAll" profile=user
```

等待页面完全加载（这个页面比较慢，需要耐心等待）：

```
browser action=wait event=networkidle timeout=95000 profile=user
```

### 第二步：输入合同号查询

#### 2.1 定位"原合同号"输入框

使用无障碍快照找到输入框：

```
browser action=snapshot profile=user
```

在快照中找到名称为"原合同号"的 textbox 元素，记录其 ref 编号。

#### 2.2 填入合同号

先双击输入框激活编辑模式（Webix 组件需要双击才能进入编辑状态）：

```
browser action=click ref=<原合同号输入框ref> profile=user
browser action=click ref=<原合同号输入框ref> profile=user
```

此时会出现一个 textarea 获得焦点。使用 JavaScript 定位聚焦的 textarea 并填入合同号：

```
browser action=evaluate script="document.querySelector('textarea:focus').value = '<合同号>'; document.querySelector('textarea:focus').dispatchEvent(new Event('input', {bubbles: true}));" profile=user
```

如果用户提供了**多个合同号**，用 Tab 字符分隔：
```
browser action=evaluate script="document.querySelector('textarea:focus').value = '<合同号1>\t<合同号2>\t<合同号3>'; document.querySelector('textarea:focus').dispatchEvent(new Event('input', {bubbles: true}));" profile=user
```

然后按 Escape 关闭编辑模式：

```
browser action=press key=Escape profile=user
```

#### 2.3 清空"订单履行经理"字段

**重要**：必须清空此字段，否则查询结果会被过滤。

在快照中找到名称为"订单履行经理"的 textbox，双击进入编辑，清空内容：

```
browser action=click ref=<订单履行经理ref> profile=user
browser action=click ref=<订单履行经理ref> profile=user
browser action=evaluate script="if(document.querySelector('textarea:focus')){document.querySelector('textarea:focus').value=''; document.querySelector('textarea:focus').dispatchEvent(new Event('input', {bubbles: true}));}" profile=user
browser action=press key=Escape profile=user
```

#### 2.4 点击"查询"按钮

在快照中找到名称为"查询"的 button，点击：

```
browser action=click ref=<查询按钮ref> profile=user
```

等待查询结果加载完成：

```
browser action=wait event=networkidle timeout=95000 profile=user
```

### 第三步：截图结果页面

```
browser action=screenshot profile=user
```

分析截图中表格的内容和布局。

### 第四步：提取关键数据

使用 JavaScript 从 Webix 表格中提取数据。Webix 数据表格的数据存储在组件内部，可以通过 DOM 遍历提取：

```
browser action=evaluate script="
(function() {
    // 方法1：从表格 DOM 中提取可见行
    var rows = document.querySelectorAll('.webix_ss_body .webix_cell');
    if (!rows.length) {
        // 方法2：尝试从 ARIA tree 获取
        var table = document.querySelector('[role=\"treegrid\"], [role=\"grid\"]');
        if (table) {
            var trs = table.querySelectorAll('[role=\"row\"]');
            var result = [];
            trs.forEach(function(tr) {
                var cells = tr.querySelectorAll('[role=\"gridcell\"]');
                var row = {};
                cells.forEach(function(c) { row[c.getAttribute('aria-colindex')] = c.textContent.trim(); });
                if (Object.keys(row).length > 0) result.push(row);
            });
            return JSON.stringify(result.slice(0, 50));
        }
    }
    // 方法3：直接读取可见文本行
    var container = document.querySelector('.webix_ss_body');
    return container ? container.innerText : 'NO_TABLE_FOUND';
})()
" profile=user
```

**备选方案**：如果 JavaScript 提取不理想，使用无障碍快照获取表格内容：

```
browser action=snapshot profile=user
```

从快照的 ARIA 树中解析表格行，找到以下列的数据：
- **原合同号** — 合同编号
- **发货批次** — 批次号
- **RPD** — 要求生产日期
- **CPD** — 承诺交单时间

### 第五步：格式化输出

将提取的数据整理为 markdown 表格：

| 原合同号 | 批次号 | RPD | CPD |
|----------|--------|-----|-----|
| 1Y0xxxxx | 001 | 2026-01-20 | 2026-01-25 |
| 1Y0xxxxx | 002 | 2026-02-15 | 2026-02-20 |

## 错误处理

- **页面显示登录界面**：告诉用户 "W3 登录已过期，请在 Chrome 中重新登录 w3.huawei.com，然后再试。"
- **CDP 连接失败**：告诉用户 "无法连接到 Chrome。请先运行 setup_chrome_debug.bat 启动带远程调试的 Chrome。"
- **查询无结果**：告诉用户 "未查询到该合同号的批次信息，请确认合同号是否正确。"
- **页面加载超时**：告诉用户 "页面加载超时，W3 系统可能响应较慢，请稍后重试。"
- **找不到输入框或按钮**：先截图，展示当前页面状态，询问用户是否需要手动操作。

## 使用示例

```
用户: "帮我查一下合同 1Y0123456 的批次信息"
→ 导航到供应链工作台 → 输入合同号 → 查询 → 截图 → 提取并展示 原合同号/批次号/RPD/CPD

用户: "查一下这几个合同 1Y0111111 1Y0222222 1Y0333333"
→ 多个合同号用 Tab 分隔填入 → 查询 → 提取所有批次数据

用户: "这个合同的 RPD 和 CPD 分别是什么时候"
→ 查询并重点展示 RPD 和 CPD 日期信息
```

## 注意事项

- 查询前务必清空"订单履行经理"字段，避免结果被默认过滤。
- Webix 组件的输入框需要**双击**才能进入编辑模式。
- 页面加载较慢，`networkidle` 超时建议设为 95 秒。
- 如果结果超过一页，需要在页面底部切换分页器查看更多数据。
- 表格列较多，滚动右侧才能看到 RPD/CPD 列，提取数据时优先使用 JavaScript 而非截图。
