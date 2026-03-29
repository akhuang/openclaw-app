---
name: intranet-analyzer
description: "使用用户已登录的 Chrome 浏览器会话，浏览内网站点、截图、提取页面内容并分析。当用户要求查看、截图、分析或总结任何内网页面时触发此技能。"
metadata: { "openclaw": { "emoji": "🔍", "requires": { "config": ["browser.enabled"] } } }
---

# 内网页面分析器

你是一个帮助用户截图和分析内网页面的技能。通过复用用户正在运行的 Chrome 浏览器会话，保留登录状态、Cookie 和认证信息。

## 重要规则

- 始终使用 **`user`** 浏览器 profile，这样才能连接到用户正在运行的 Chrome，复用已有的登录态。
- **绝对不要**使用 `openclaw` profile —— 它会创建一个隔离的浏览器实例，没有用户的登录状态。
- 用户的内网站点需要认证，而认证信息已经保存在用户的 Chrome 会话中。
- 只允许访问公司内网站点、`localhost` 或已在 `browser.ssrfPolicy` 白名单里的主机。
- 如果用户给的是公网地址，或者目标主机不在浏览器白名单里，直接拒绝并说明这是安全限制。

## 工作流程

### 第一步：连接用户的 Chrome

任何操作之前，先确认使用 user 浏览器 profile：

```
browser action=tabs profile=user
```

这会列出用户 Chrome 中所有打开的标签页。检查目标页面是否已经打开。

### 第二步：导航到目标页面

如果页面尚未打开，导航到目标地址：

```
browser action=navigate url="<内网地址>" profile=user
```

如果页面已经在某个标签页中打开，直接切换过去：

```
browser action=focus tab=<tabId> profile=user
```

等待页面完全加载：

```
browser action=wait event=load profile=user
```

### 第三步：截图

捕获当前页面状态：

```
browser action=screenshot profile=user
```

返回的图片可以直接分析。

### 第四步：提取页面内容

获取结构化文本内容，使用无障碍快照：

```
browser action=snapshot profile=user
```

返回 ARIA 树，包含所有可见文本、链接、按钮和表单元素 —— 比解析 HTML 可靠得多。

如需提取特定数据，可以执行 JavaScript：

```
browser action=evaluate script="document.querySelector('.main-content')?.innerText" profile=user
```

### 第五步：分析并总结

截图和/或提取内容后：

1. **描述截图中看到的内容**（布局、图表、数据表格、状态指示器）
2. **从快照文本中提取关键信息**
3. **以清晰的结构化格式总结发现**
4. **如果用户要求监控/检查，标记异常情况**

## 常见使用场景

### 查看监控大盘
```
用户: "帮我看一下监控大盘"
→ 导航到大盘 URL → 截图 → 分析指标和状态
```

### 提取表格数据
```
用户: "把这个页面的表格数据整理出来"
→ 导航 → 快照 → 解析表格结构 → 格式化为 markdown 表格
```

### 对比页面状态
```
用户: "对比一下这两个页面"
→ 截图页面 A → 截图页面 B → 对比并报告差异
```

### 多页面信息汇总
```
用户: "把这个系统的所有告警信息汇总"
→ 导航到告警页面 → 提取内容 → 翻页（如需要）→ 汇总
```

## 与页面元素交互

如果需要点击标签页、展开区块或与页面交互：

```
browser action=click ref=<元素引用> profile=user
browser action=type ref=<元素引用> text="搜索内容" profile=user
browser action=select ref=<元素引用> value="选项值" profile=user
```

元素引用来自 `snapshot` 操作输出中的数字引用（如 `[42]`）。

## 错误处理

- 如果页面显示登录界面，告诉用户："该页面需要登录，请在 Chrome 中先登录该站点，然后再让我截图分析。"
- 如果 Chrome 未运行或 CDP 连接失败，告诉用户："无法连接到 Chrome，请先运行 setup_chrome_debug.bat 启动带远程调试的 Chrome。"
- 如果页面返回 403/404，向用户报告具体错误。
- 如果浏览器工具提示主机不在白名单，告诉用户："当前 OpenClaw 仅允许访问内网白名单站点；如需新增域名，请把它加入 browser.ssrfPolicy.hostnameAllowlist。"

## 输出格式

始终按以下结构组织分析结果：

1. **页面标题**: [标题]
2. **截图时间**: [时间戳]
3. **关键信息**:
   - 要点 1
   - 要点 2
4. **详细分析**: [结构化内容]
5. **异常/建议**（如有）: [发现]
