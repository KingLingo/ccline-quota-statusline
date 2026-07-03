# ccline-quota-statusline

Append **API spend-quota progress bars** to the [CCometixLine](https://github.com/LemonYangZW/CCometixLine) (`ccline`) Claude Code status line — sourced from a **Sub2API-style gateway's self-service `GET /v1/usage`** endpoint, using the API key you already have. **No admin credentials required.** Cross-platform: macOS / Linux / Windows.

```
🤖 Sonnet 5 | 📁 Downloads | 🌿 main | ⚡️ 12% · 45k tokens | 💰 $0.42
Daily   ███░░░░░░░░░░░   7%  $65.01 left  Claude - 300档
Weekly  █░░░░░░░░░░░░░   3%
Monthly ░░░░░░░░░░░░░░  <1%
```

> Rows carry **no leading whitespace** and start with an equal-width (`padEnd`) label, so the bars align even though Claude Code strips each row's leading spaces and re-indents the whole status line uniformly. (Earlier gutter/emoji-prefixed layouts broke because that leading space got stripped.)

- The first line is CCometixLine's normal output (model / dir / git / context / cost).
- The **quota rows** are added by this project: one progress bar per spend window (Daily / Weekly / Monthly), plus remaining balance and plan name.
- Bars follow [claude-hud](https://github.com/jarrodwatts/claude-hud) coloring — filled cells colored by **used %** (≥90 % red, ≥75 % magenta, else blue), empty cells dim gray. The aligned-column layout & color scheme were designed with **GPT-5.5**.

---

## Why a wrapper?

CCometixLine's own `sub2_api` segment needs **admin** credentials (it inspects which upstream account a shared gateway is using). To just show **your own key's remaining balance**, the Sub2API gateway exposes a per-key endpoint:

```
GET  {ANTHROPIC_BASE_URL}/v1/usage
Authorization: Bearer {ANTHROPIC_API_KEY}
```

This wrapper calls `ccline` for the normal status line, queries `/v1/usage` in parallel, and appends the quota bars. It never touches admin APIs.

---

## Requirements

- **Node.js ≥ 18** (uses global `fetch` and top-level `await`).
- **Claude Code**.
- A **Sub2API-style gateway** set as your `ANTHROPIC_BASE_URL` that answers `GET /v1/usage` with a JSON body shaped like:
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
  Missing fields degrade gracefully (fewer rows). If your gateway has no `/v1/usage`, only the normal `ccline` line shows.

---

## Install

```bash
git clone https://github.com/<you>/ccline-quota-statusline.git
cd ccline-quota-statusline
node install.mjs
```

The installer will:
1. Install `@nekoline/ccline` globally if it isn't already.
2. Copy `quota-wrapper.mjs` (and `config.toml` on first run) into `~/.claude/ccline/`.
3. Write the `statusLine` command into **`~/.claude/settings.local.json`** (see the gotcha below).

Then **fully quit and relaunch Claude Code** (a new session inside a still-running app is not enough — the status line command is read at startup).

### ⚠️ Why `settings.local.json`, not `settings.json`

Claude Code periodically **rewrites `~/.claude/settings.json`** (e.g. when you change the model or other settings) and **drops the `statusLine` key** in the process. So this project writes `statusLine` into `~/.claude/settings.local.json`, which Claude Code merges but does not rewrite. If you configure it by hand, put it there.

### Manual setup (if you prefer not to run the installer)

Copy `quota-wrapper.mjs` + `config.toml` into `~/.claude/ccline/`, then add to `~/.claude/settings.local.json`:

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
> The installer writes bare `node` (it's on `PATH` and survives Node upgrades). If your status-line subprocess has a minimal `PATH` without `node`, swap in an absolute node path, e.g. `"/opt/homebrew/bin/node \"…/quota-wrapper.mjs\""`.

**Windows** (use [Windows Terminal](https://aka.ms/terminal) for correct block-character & ANSI rendering)
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"%USERPROFILE%\\.claude\\ccline\\quota-wrapper.mjs\"",
    "padding": 0
  }
}
```
> The installer writes `node "<absolute wrapper path>"` (quoted). If `node` isn't on the status-line PATH, replace it with the absolute path to `node.exe`.

---

## Configuration

### Layout mode — `QUOTA_MODE` env var

| Value | Result |
|-------|--------|
| *(unset)* | **auto**: stacked bars normally, compact single row when the terminal is narrow (< 72 cols) |
| `stacked` | force the multi-row stacked bars |
| `compact` | force one compact row: `D █░░ 7% · W █░░ 3% · M ░░ <1%  $65 left` |
| `off` | hide quota rows (plain `ccline` only) |

Set it in your shell profile or in the `env` block of `settings.local.json`.

### Bars & colors

Tunables live at the top of `quota-wrapper.mjs`:

- `WIDTH` / `WIDTH_COMPACT` — bar width in cells (default 14 / 6).
- `NARROW_COLS` — width threshold to auto-switch to compact.
- `fillColor()` — the ≥90 / ≥75 / else color thresholds.
- `DIM_GRAY`, `RED`, `BRIGHT_MAGENTA`, `BRIGHT_BLUE` — ANSI codes.

### CCometixLine segments

`config.toml` controls the first (normal) status line — model, directory, git, context window, cost, session, etc. Run `ccline -c` for its interactive TUI, or edit `~/.claude/ccline/config.toml` directly.

### Gateway credentials

By default the wrapper reads `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` from the environment, then from `settings.local.json`, then `settings.json`. Override just for the quota query with `QUOTA_BASE_URL` / `QUOTA_API_KEY`.

---

## How it works

- Reads the status-line JSON from **stdin**, forwards it to the real `ccline` binary for line 1.
- In parallel, `GET {baseUrl}/v1/usage` with a **2.5 s timeout**; result cached in `~/.claude/ccline/.quota_cache.json` for **60 s** so every repaint doesn't hit the gateway.
- On any failure it serves the last cached value, or simply omits the quota rows — the status line never breaks.
- `ccline` binary is resolved per-platform (`ccline` / `ccline.exe` in `~/.claude/ccline/`, else the `ccline` command on `PATH`).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Nothing shows after install | **Fully quit** and relaunch Claude Code. Confirm `statusLine` is present in `~/.claude/settings.local.json`. |
| Status line lost after changing model | Expected — Claude Code rewrote `settings.json`. Keep `statusLine` in `settings.local.json` (the installer does). |
| Bars render but no quota rows | Your gateway may not serve `GET /v1/usage`, or the key is invalid. Test: `curl -H "Authorization: Bearer $KEY" $BASE/v1/usage`. |
| Boxes/`?` instead of `█ ░` on Windows | Use Windows Terminal with a modern font; legacy `conhost` with raster fonts can't render block elements. |
| Misaligned columns | Rows have no leading whitespace and start with an equal-width label, so alignment survives Claude Code's per-row leading-space stripping. If bars still drift, your font may render `█`/`░` as non-single-width — try a different monospace font. |

---

## Credits

- [CCometixLine](https://github.com/LemonYangZW/CCometixLine) — the Rust status-line tool this wraps (`@nekoline/ccline`).
- [claude-hud](https://github.com/jarrodwatts/claude-hud) — progress-bar coloring semantics.
- Layout & color scheme designed with **GPT-5.5**.
- Gateway: [Sub2API](https://github.com/Wei-Shaw/sub2api).

## License

MIT © 2026 KingLin
