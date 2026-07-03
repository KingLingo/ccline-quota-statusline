语言：[English](README.md) | **中文**

# ccline-quota-statusline（中文）

在 [CCometixLine](https://github.com/LemonYangZW/CCometixLine)（`ccline`）的 Claude Code 状态栏下面，追加 **API 额度进度条**——数据来自 **Sub2API 类网关自带的自助接口 `GET /v1/usage`**，用你现有的 API Key 即可，**不需要管理员账号**。跨平台：macOS / Linux / Windows。

```
🤖 Sonnet 5 | 📁 Downloads | 🌿 main | ⚡️ 12% · 45k tokens | 💰 $0.42
Daily   ███░░░░░░░░░░░   7%  $65.01 left  Claude - 300档
Weekly  █░░░░░░░░░░░░░   3%
Monthly ░░░░░░░░░░░░░░  <1%
```

- 第一行是 CCometixLine 的正常输出（模型 / 目录 / git / 上下文 / 花费）。
- **额度那几行**由本项目追加：每个额度窗口（日 / 周 / 月）一条进度条，外加剩余余额和套餐名。
- 进度条配色沿用 [claude-hud](https://github.com/jarrodwatts/claude-hud) 的语义——填充块按**已用百分比**着色（≥90% 红、≥75% 品红、否则蓝），空槽暗灰。对齐布局与配色方案由 **GPT-5.5** 设计。

> **对齐说明**：每行**不带任何行首空白**，直接以等宽（`padEnd`）标签开头。这样即便 Claude Code 会把每行开头的空白删掉、再对整条状态栏统一缩进，三条进度条也始终对齐。（早期用 emoji / 空格 gutter 做前缀的版本就是因为这段行首空白被删掉而错位的。）

---

## 为什么用一个 wrapper？

CCometixLine 自带的 `sub2_api` 段需要**管理员**账号（它查的是共享网关当前在用哪个上游账号）。而如果你只想看**自己这把 Key 的剩余额度**，Sub2API 网关有一个按 Key 查询的自助接口：

```
GET  {ANTHROPIC_BASE_URL}/v1/usage
Authorization: Bearer {ANTHROPIC_API_KEY}
```

本 wrapper 调用 `ccline` 拿到正常状态栏，同时并行请求 `/v1/usage`，把额度进度条拼在后面。全程不碰任何管理员接口。

---

## 环境要求

- **Node.js ≥ 18**（用到全局 `fetch` 和顶层 `await`）。
- **Claude Code**。
- 一个设为你 `ANTHROPIC_BASE_URL` 的 **Sub2API 类网关**，且 `GET /v1/usage` 返回形如下面的 JSON：
  ```json
  {
    "remaining": 67.84, "unit": "USD", "planName": "Claude - 300档",
    "subscription": {
      "daily_limit_usd": 70,   "daily_usage_usd": 2.16,
      "weekly_limit_usd": 350, "weekly_usage_usd": 3.09,
      "monthly_limit_usd": 1500, "monthly_usage_usd": 3.09
    }
  }
  ```
  字段缺失会**优雅降级**（少画几行）。如果你的网关没有 `/v1/usage`，就只显示正常的 `ccline` 那一行。

---

## 接入与使用

两种方式任选其一。**方案 A 是让 Claude Code 帮你一键接入，方案 B 是手动。**

### 方案 A：让 Claude Code 帮你接入（最省事）

直接在 Claude Code 里粘贴这段话：

```
克隆 https://github.com/KingLingo/ccline-quota-statusline 到本地并运行 `node install.mjs`，
把 ccline 的额度进度条接入我的 Claude Code 状态栏。完成后告诉我要不要重启。
```

它会自动 clone、跑安装器、把 `statusLine` 写进 `settings.local.json`。之后**完全退出并重启 Claude Code** 即可。

### 方案 B：自行接入（手动）

```bash
git clone https://github.com/KingLingo/ccline-quota-statusline.git
cd ccline-quota-statusline
node install.mjs
```

安装器会：
1. 若未安装则全局装 `@nekoline/ccline`；
2. 把 `quota-wrapper.mjs`（首次含 `config.toml`）拷进 `~/.claude/ccline/`；
3. 把 `statusLine` 命令写进 **`~/.claude/settings.local.json`**（原因见下方「坑」）。

然后**完全退出并重启 Claude Code**（在还开着的应用里新开一个会话不够——状态栏命令是启动时读取的）。

<details>
<summary>不想跑安装器？纯手动配置（macOS / Windows）</summary>

把 `quota-wrapper.mjs` + `config.toml` 拷进 `~/.claude/ccline/`，再往 `~/.claude/settings.local.json` 加：

**macOS / Linux**
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"$HOME/.claude/ccline/quota-wrapper.mjs\"",
    "padding": 0
  }
}
```

**Windows**（建议用 [Windows Terminal](https://aka.ms/terminal) 才能正确渲染 `█ ░` 和 ANSI 颜色）
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"%USERPROFILE%\\.claude\\ccline\\quota-wrapper.mjs\"",
    "padding": 0
  }
}
```
> 若状态栏子进程的 PATH 里没有 `node`，把 `node` 换成 node 可执行文件的绝对路径。
</details>

### ⚠️ 为什么写 `settings.local.json` 而不是 `settings.json`

Claude Code 会**周期性重写 `~/.claude/settings.json`**（比如你切换模型时），并在重写时**把 `statusLine` 键丢掉**。所以本项目把 `statusLine` 写进 `~/.claude/settings.local.json`——它会被 Claude Code 合并读取，但不会被重写。手动配置也请放这里。

---

## 独立查额度（任意终端）

不接状态栏，也能随手打印额度进度条：

```bash
node ~/.claude/ccline/quota-wrapper.mjs --quota
```

输出就是额度行（不含 ccline 行），适合在任意终端快速看一眼额度。若已 `npm install -g`（或 `npm link`），可直接用 `ccline-quota` 命令。`--help` 看用法。

---

## 配置

### 布局模式 —— 环境变量 `QUOTA_MODE`

| 取值 | 效果 |
|------|------|
| *(不设)* | **自动**：正常多排进度条；终端很窄（< 72 列）时切紧凑单行 |
| `stacked` | 强制多排进度条 |
| `compact` | 强制单行：`D █░░ 7% · W █░░ 3% · M ░░ <1%  $65 left` |
| `off` | 隐藏额度行（只留 `ccline`）；`--quota` 独立模式下此项被忽略 |

写进 shell 配置，或写进 `settings.local.json` 的 `env` 块。

### 进度条与配色

可调项都在 `quota-wrapper.mjs` 顶部：`WIDTH` / `WIDTH_COMPACT`（进度条宽度）、`NARROW_COLS`（自动切紧凑的宽度阈值）、`fillColor()`（≥90 / ≥75 / 其余的着色阈值）、`RED`/`BRIGHT_MAGENTA`/`BRIGHT_BLUE`/`DIM_GRAY`（ANSI 码）。

### CCometixLine 各段

`config.toml` 控制第一行（正常状态栏）——模型、目录、git、上下文、花费、会话等。跑 `ccline -c` 进它的交互式 TUI，或直接改 `~/.claude/ccline/config.toml`。

### 网关凭据

默认按 环境变量 → `settings.local.json` → `settings.json` 的顺序读取 `ANTHROPIC_BASE_URL` 加 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`。想只给额度查询单独指定，用 `QUOTA_BASE_URL` / `QUOTA_API_KEY` 覆盖。

---

## 工作原理

- 从 **stdin** 读状态栏 JSON，转发给真正的 `ccline` 二进制生成第一行。
- 并行 `GET {baseUrl}/v1/usage`，**2.5 秒超时**；结果缓存在 `~/.claude/ccline/.quota_cache.json`，**60 秒** 内复用，避免每次重绘都打网关。
- Sub2API 订阅模式返回 Daily / Weekly / Monthly 时照旧渲染；`quota_limited` 返回 `rate_limits` 时渲染为 `5h`、Daily、Weekly 等额度条，配色语义仍沿用 claude-hud。
- 任何失败都退回上次缓存，或干脆不画额度行——状态栏永远不会崩。
- `ccline` 二进制按平台解析（`~/.claude/ccline/` 下的 `ccline` / `ccline.exe`，找不到则用 PATH 上的 `ccline`）。

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 安装后什么都没显示 | **完全退出**并重启 Claude Code；确认 `~/.claude/settings.local.json` 里有 `statusLine`。 |
| 切模型后状态栏没了 | 正常——Claude Code 重写了 `settings.json`。把 `statusLine` 放 `settings.local.json`（安装器就是这么做的）。 |
| 有进度条但没额度行 | 你的网关可能没有 `GET /v1/usage`，或 Key 失效。测试：`curl -H "Authorization: Bearer $KEY" $BASE/v1/usage`。 |
| Windows 上 `█ ░` 显示成方块/问号 | 用 Windows Terminal + 现代字体；老式 conhost 的点阵字体渲染不了块字符。 |
| 列没对齐 | 每行无行首空白、以等宽标签开头，本该对齐；若仍偏移，多半是字体把 `█`/`░` 渲染成非等宽，换个等宽字体。 |

---

## 致谢

- [CCometixLine](https://github.com/LemonYangZW/CCometixLine) —— 被包装的 Rust 状态栏工具（`@nekoline/ccline`）。
- [claude-hud](https://github.com/jarrodwatts/claude-hud) —— 进度条配色语义。
- 布局与配色方案由 **GPT-5.5** 设计。
- 网关：[Sub2API](https://github.com/Wei-Shaw/sub2api)。

## 许可

MIT © 2026 KingLin
