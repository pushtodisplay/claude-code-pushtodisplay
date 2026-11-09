# claude-code-pushtodisplay

**Push To Display** plugin for [Claude Code](https://code.claude.com) — mirrors your agent's activity onto your Push To Display board in real time.

A panel is a **shared scrolling log** (1 of 4). Every entry is its own message,
newest at the top, and every entry has the same shape:

```
<agent> <what happened> <STATUS> <HH:MM>
```

```
release session closed ENDED 12:10
release Pinned the clock so the release test passes. DONE 12:09
release Allow Bash: git push --force-with-lease NEEDS 12:08
release running npm test OK 12:08
release reading src/payloads.ts OK 12:07
release running grep FAIL 12:07
release fix the flaky release test RUN 12:06
release session opened READY 12:06
```

Three things get shortened, and each is shortened *by structure* first:

| Body | Rule |
| --- | --- |
| tool description | 48 characters; a long command keeps its program and subcommand (`running grep`), a long path drops its directory before its file name |
| prompt | first usable sentence, 60 characters, ellipsis at a word boundary when possible |
| result | same rule as the prompt |

The agent name leads, so a shared panel reads as one column per agent; the event
follows, and the status and clock trail. A line is four inline runs on a fixed
dark surface (`#1b2430`): the name is teal, the body near-white, the status has
its own colour, and the time is dimmed. The upper-case status is what makes a
line scannable.

## What gets posted

| Hook event | Entry | Status |
| --- | --- | --- |
| `SessionStart` (`startup`, `resume`, `clear`, `fork`) | `session opened` | `READY` |
| `SessionStart` (`compact`) | *(silent — compaction is not a restart)* | — |
| `UserPromptSubmit` | `<prompt>` | `RUN` |
| `PostToolUse` | `running npm test` | `OK` |
| `PostToolUseFailure` | `running npm test` | `FAIL` |
| `PermissionRequest` | `Allow Bash: git push` | `NEEDS` |
| `Stop` | `<last assistant message>` | `DONE` |
| `StopFailure` | `<error type / message>` | `FAIL` |
| `SessionEnd` | `session closed` | `ENDED` |
| `SubagentStart` | `delegating to Explore` | `RUN` |
| `SubagentStop` | `subagent Explore finished` | `OK` |

The status word is a **closed** vocabulary — `READY`, `RUN`, `OK`, `FAIL`,
`NEEDS`, `DONE`, `STOP`, `ENDED` — so a line can never invent its own state, and
there is no icon to decode. `READY` and `ENDED` bracket a session: silence alone
cannot distinguish a finished agent from a killed one, so the panel says when it
opens and when it closes.

Steps are posted when they **finish**, so a line states what actually happened
instead of leaving a stale "running" behind it. `FAIL` means a step failed or the
provider did; `STOP` is reserved for a user interrupt and is not inferred from a
turn that happened to end without text. `DONE` quotes the agent's own closing
text, shortened to its first usable sentence.

`PermissionRequest` is observational: the plugin logs the blocking question but
**never returns allow or deny**, so Claude Code's normal permission prompt still
reaches you. Subagent lines are deliberately low-noise and are skipped when
`PUSHTODISPLAY_STEPS=0`.

## Install

The GitHub repository is a single-plugin marketplace. In Claude Code:

```text
/plugin marketplace add pushtodisplay/claude-code-pushtodisplay
/plugin install pushtodisplay@pushtodisplay
```

Or from your shell:

```bash
claude plugin marketplace add pushtodisplay/claude-code-pushtodisplay
claude plugin install pushtodisplay@pushtodisplay
```

Restart Claude Code (or run `/reload-plugins`) after installing, then run the
setup action described below.

### Requirements

- **Claude Code 2.1.x** (the plugin uses the documented `SessionStart`,
  `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`,
  `Stop`, `StopFailure`, `SessionEnd`, `SubagentStart`, and `SubagentStop`
  hooks).
- **Node.js 18+** — hooks run `node ${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs`.
- **A Push To Display account** — setup opens the device-code login.
- **No separate CLI install.** The plugin includes a pinned `pushtodisplay`
  CLI and uses it automatically.

## Quick start

1. **Install** the plugin from the marketplace as shown above.
2. **Restart** Claude Code (or run `/reload-plugins`).
3. **Run setup**:

   ```text
   /pushtodisplay:pushtodisplay-setup
   ```

   Setup logs you in if needed, sends one test entry to the configured board and
   panel, and only then records that this Claude Code integration is set up.

Installation alone sends nothing. A login from Codex, opencode, pi, or another
integration on the same machine does not enable this plugin until this setup
action completes.

That's it. The next session shows it starting, what it is working on, failed
steps, permission prompts, and what it said when it finished.

`/pushtodisplay:pushtodisplay-status` shows auth, setup, board, panel, and label
without changing anything.

> **Command names:** Claude Code namespaces plugin commands under the plugin
> name. The files are named `pushtodisplay-setup`, `pushtodisplay-login`,
> `pushtodisplay-status`, `pushtodisplay-test`, and `pushtodisplay-clear`, so the
> commands are `/pushtodisplay:pushtodisplay-setup`, etc. Type `/pushtodisplay`
> in the `/` menu to see them.

## Configuration

All settings are environment variables, so each Claude Code session can write to
a different panel without any per-session config files:

| Env var | Default | Description |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | *(default board)* | Board ID to send to. |
| `PUSHTODISPLAY_PANEL` | `1` | Which panel (1–4) this agent writes to. |
| `PUSHTODISPLAY_LABEL` | *(cwd basename)* | Agent name in the first field of every line. |
| `PUSHTODISPLAY_STEPS` | *(on)* | Set to `0` to skip per-tool and per-subagent entries (milestones only). |
| `PUSHTODISPLAY_DISABLED` | *(off)* | Set to `1` to disable the plugin entirely. |

Set them in the environment that launches Claude Code:

```bash
PUSHTODISPLAY_PANEL=2 PUSHTODISPLAY_LABEL=release claude
```

### Multiple agents / panels

Give each parallel agent its own panel and a label:

```bash
# agent A
PUSHTODISPLAY_PANEL=1 PUSHTODISPLAY_LABEL=cicd claude

# agent B
PUSHTODISPLAY_PANEL=2 PUSHTODISPLAY_LABEL=qa claude
```

Each panel becomes its own scrolling log, so you can see what every agent did and
which one needs you. Sharing a panel between agents is fine — the agent field on
every line keeps them apart:

```
qa Allow Bash: git push NEEDS 11:41
release running npm test OK 11:40
```

With no explicit `PUSHTODISPLAY_LABEL`, the label is the folder name of the
session's working directory; launching from two different repos already gives
you two distinct agents.

## Commands

| Command | Description |
| --- | --- |
| `/pushtodisplay:pushtodisplay-setup` | Log in if needed, send a test entry, and enable this Claude Code integration. |
| `/pushtodisplay:pushtodisplay-login` | Re-authenticate after an expired or revoked login. |
| `/pushtodisplay:pushtodisplay-status` | Show auth, setup, board, panel, and label. |
| `/pushtodisplay:pushtodisplay-test` | Send a test entry to verify wiring. |
| `/pushtodisplay:pushtodisplay-clear` | Write a `log cleared` entry to this panel. |

The commands run a bundled script through Claude Code's dynamic context
injection; `allowed-tools` pre-approves only that script. The setup command
starts the device-code flow when needed, prints the URL and code, opens the
browser when possible, waits for the login, sends one test entry, and only then
writes this integration's setup marker. The login command is the shorter
re-authentication path and leaves an existing marker untouched.
`/pushtodisplay:pushtodisplay-status` forces an auth re-probe.

## How it works

```
Claude Code hooks ──► hook.mjs ──► state file ──► drainer ──► CLI ──► API
(session/task/          (one event   (~/.cache/    (ordered,   (OAuth)
 tool/permission/        per line)    pushtodisplay/ bounded,
 result/session)                     claude-code/)  deduped,
                                                   ≥1.2s apart)
```

- **One event, one line.** `lib/events.mjs` is the pure mapping from hook JSON
  to a payload; there is no "current status" object to render.
- **Per-session state.** Every hook invocation is a separate process, so the
  task, last assistant text, queue, last-send time, and dedupe key live in
  `~/.cache/pushtodisplay/claude-code/<session_id>.json`. Auth is shared in
  `auth.json` because it is account-level, not session-level; `setup.json` is
  this integration's own marker.
- **Fast hooks, ordered sends.** Ordinary hooks enqueue under a short lock and
  spawn a detached drainer, then exit. The drainer holds a separate lock, sends
  the queue in order, suppresses consecutive duplicates, trims the oldest
  non-urgent entries when the backlog is too long, and spaces sends ≥ 1.2 s
  apart. `Stop` drains synchronously so `DONE` is not lost; `SessionEnd` tries a
  synchronous flush within its 1.5 s budget and leaves a detached drainer as a
  safety net.
- **Setup and auth gating.** A send requires both this integration's setup
  marker and a valid login. Installation alone sends nothing, even when the
  machine already has a working credential from another integration. The first
  send probes `pushtodisplay auth status --json` and waits for the answer. Once
  auth is known to be bad, updates are dropped (never buffered) and re-probed
  lazily at most once every 20 s. A successful login writes the shared auth
  cache, so sending resumes without a restart.
- **Bundled CLI.** The plugin ships a pinned `pushtodisplay` CLI and invokes it
  directly; there is no separate install and no runtime package download. If the
  bundled copy is unexpectedly missing, an internal PATH lookup is the fallback.
- **Hooks never block Claude.** Hook failures are swallowed and always exit 0;
  a board that is down must not break the coding session.

## Trust and security

Plugins and hooks run with your user privileges. Before installing any plugin,
review its source:

- **What leaves your machine.** The plugin sends the agent label, prompts, tool
  names and arguments (commands, file paths, URLs, search queries), subagent
  names, assistant closing text, and error details to your Push To Display
  board. Do not enable it on repositories whose prompts or paths are sensitive
  unless that is acceptable.
- **What runs.** `hooks/hook.mjs` and `scripts/command.mjs` are plain Node
  scripts with no third-party runtime dependencies. They call `node` and the
  `pushtodisplay` CLI. The plugin does not run arbitrary shell commands from
  hook input.
- **Permissions.** `PermissionRequest` only observes; it never returns an
  allow/deny decision. Your normal permission prompts still apply.
- **Credentials.** Auth is OAuth-only, handled by the `pushtodisplay` CLI.
  Credentials live in the OS keychain (macOS Keychain, Linux libsecret, Windows
  Credential Manager), with a plaintext fallback at
  `~/.config/pushtodisplay/credentials.json` only when no keychain is
  available. The plugin never reads or stores the token itself.
- **Network.** The only destination is your Push To Display board. The CLI
  sends updates to `https://api.pushtodisplay.com`; the OAuth device-code login
  uses `https://idp.pushtodisplay.com`. The plugin has no analytics, telemetry,
  or other network calls, and it does not download or install packages at
  runtime.
- **Retention.** Board history is stored by Push To Display under your account;
  `/pushtodisplay:pushtodisplay-clear` writes a marker and does not delete
  history. Local session state stays under
  `~/.cache/pushtodisplay/claude-code/` until you delete it. Push To Display
  stores message payloads temporarily for delivery and may retain them in logs
  for up to 90 days; see the
  [privacy policy](https://pushtodisplay.com/privacy).
- **Disable.** Set `PUSHTODISPLAY_DISABLED=1` to make every hook a no-op, or
  disable/uninstall the plugin in `/plugin`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No lines at all | Run `/pushtodisplay:pushtodisplay-status`; confirm setup is complete, auth is valid, and board/panel are right. Check `PUSHTODISPLAY_DISABLED` is not `1`. A fresh install stays silent until setup completes. |
| `CLI not found` | Reinstall the plugin; it includes the CLI it needs. |
| Setup not complete | Run `/pushtodisplay:pushtodisplay-setup`. |
| Not authenticated | If setup is complete, run `/pushtodisplay:pushtodisplay-login`; otherwise run setup. If the browser does not open, open the printed URL manually and enter the code. |
| Lines lag behind | The queue is bounded and spaced ≥1.2 s. A burst of tool calls is trimmed to the newest steps; use `PUSHTODISPLAY_STEPS=0` for milestones only. |
| Too much volume | `PUSHTODISPLAY_STEPS=0` drops tool and subagent entries; tasks, results, permissions, errors, and lifecycle remain. |
| Permission prompt not shown on board | `PermissionRequest` fires only when Claude Code actually asks for permission. Auto-approved calls and sandbox network prompts may not produce this event. |
| Hook never fires | Run `claude --debug` and search for `Hooks:` lines. Confirm the plugin is enabled (`/plugin`) and Claude Code is 2.1.x. |
| Corrupt/stale state | Delete `~/.cache/pushtodisplay/claude-code/` and run setup again. |
| Plugin does not load | Reinstall the plugin, or run `claude plugin validate .` from a source checkout. |

Debug logging: `claude --debug` records each hook invocation and its exit status.
The plugin's own send errors are stored in the session state's `lastError` field
and are not printed to the transcript.

## Development

```bash
npm ci
npm run check          # typecheck + lint + test
npm test               # fixture, queue, auth, setup, command, and hook integration tests
npm run typecheck
npm run lint
npm run validate:plugin
```

`npm run validate:plugin` requires the Claude Code CLI (`claude`) on `PATH`.
It runs the local directory-profile validation with warnings treated as errors.

The runtime is plain ESM with JSDoc types, so `node hooks/hook.mjs` runs without
a build step. Tests use Node's built-in test runner and a fake `pushtodisplay`
executable on a temporary `PATH`; the integration test copies `hooks/` and `lib/`
to a temp directory with no `node_modules` or vendor directory, which exercises
the internal PATH fallback and the detached-drainer path.

Local checkout installs, the vendored CLI update procedure, and the internal
resolution order are documented in [`docs/maintainers.md`](docs/maintainers.md).

Useful manual checks:

```bash
# Load the plugin in a throwaway session and inspect its component inventory
claude --plugin-dir . plugin details pushtodisplay

# Validate the manifest, marketplace, hooks, and commands
claude plugin validate .

# Simulate a hook event by hand (uses the real cache and CLI)
echo '{"session_id":"demo","cwd":"'$PWD'","hook_event_name":"SessionStart","source":"startup"}' \
  | node hooks/hook.mjs
```

## Architecture

| File | Responsibility |
| --- | --- |
| `hooks/hook.mjs` | Hook entry point: read stdin, persist state, spawn/drain the queue. |
| `hooks/hooks.json` | Hook event wiring (exec form, `${CLAUDE_PLUGIN_ROOT}` paths). |
| `lib/events.mjs` | Pure hook-event → board-line mapping. |
| `lib/messages.mjs` | One-sentence message builders — the whole visible vocabulary. |
| `lib/describe.mjs` | Human-readable tool and permission descriptions, including Claude tool names. |
| `lib/sender.mjs` | Queue policy: order, dedupe, bounded backlog, 1.2 s spacing. |
| `lib/state.mjs` | Per-session state, auth cache, atomic writes, cross-process locks. |
| `lib/auth-gate.mjs` | Unknown / logged in / logged out; unknown waits, known-bad drops. |
| `lib/setup-state.mjs` | Per-integration setup marker written only after auth + test send. |
| `lib/cli-adapter.mjs` | CLI resolution, argv mapping, auth probing, error classification. |
| `lib/config.mjs` | Env-var config parsing + string/time helpers. |
| `lib/panel-state.mjs` | The task/result text and assistant-text cleanup. |
| `lib/payloads.mjs` | Wire types and the palette. |
| `lib/device-code.mjs` | Parse the CLI's device-code URL and code. |
| `scripts/command.mjs` | `/pushtodisplay:*` command implementations. |
| `scripts/login-worker.mjs` | Detached device-code login worker. |
| `vendor/pushtodisplay/` | Pinned `pushtodisplay` CLI 0.1.19; no install step needed. |
| `.claude-plugin/plugin.json` | Plugin manifest. |
| `.claude-plugin/marketplace.json` | Single-plugin marketplace catalog. |

## License

MIT. PushToDisplay is a product of Goban Source, LLC — see
[pushtodisplay.com](https://pushtodisplay.com).
