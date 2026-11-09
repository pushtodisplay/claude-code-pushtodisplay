# Claude plugin directory submission packet

Status: **ready for portal validation and submission**. Everything that can be
done without the submitting claude.ai account is complete. The repository is
public, all local checks pass, and the remaining steps require the user's paid
claude.ai account and connected GitHub identity.

This packet is not a submission and does not claim a review result. The
directory is curated; validation, security scanning, review, and publishing all
happen in Anthropic's developer portal after the user submits.

## Listing identity

| Field | Value |
| --- | --- |
| Repository | `https://github.com/pushtodisplay/claude-code-pushtodisplay` |
| Plugin path | `/` (repository root; `.claude-plugin/plugin.json` is at the root) |
| Tracked branch | `main` (the repository default) |
| Plugin name | `pushtodisplay` |
| Display name | `Push To Display` |
| Listing description | `Mirror Claude Code agent activity onto your Push To Display board as a shared, human-readable log.` |
| Marketplace | `pushtodisplay` (single plugin, `source: "./"`) |
| Category / tags | `monitoring`; `status`, `display`, `dashboard`, `notifications`, `hooks` |
| Release version | `0.1.1` (`plugin.json`, `package.json`, and `package-lock.json`) |
| License | MIT (`LICENSE` and `plugin.json`) |
| Author / contact | Goban Source LLC, `hello@pushtodisplay.com`, `https://pushtodisplay.com` |
| Repository visibility | **Public** (verified with `gh repo view`) |
| Distribution | The GitHub repository is its own marketplace. npm publishing is not required and no npm publish path is planned. |

The README is the listing body. It documents the hook events, what each entry
contains, installation, configuration, CLI resolution, security behavior, and
retention.

## What the plugin does

Push To Display mirrors Claude Code activity onto a Push To Display board as a
shared scrolling log. Ten Claude Code hook events create short entries for
session lifecycle, prompts, finished tool calls, permission prompts, subagent
activity, results, errors, and session close. Four slash commands log in, show
status, send a test entry, and write a clear marker.

At runtime the hooks read Claude Code hook JSON from stdin, update a per-session
state file, and invoke the `pushtodisplay` CLI, which sends the entry to the
user's board over HTTPS. The plugin never returns permission decisions and
never runs shell commands from hook input.

## Data handling answers for the portal

These are the answers to the portal's **Data handling** step.

### Does the plugin read or store personal data?

**Yes.** The plugin reads Claude Code hook event data, which can contain personal
or sensitive information:

- the session id and working directory;
- user prompts;
- tool names, commands, file paths, URLs, and search queries;
- the assistant's closing message;
- subagent names;
- error types and messages;
- the agent label, which defaults to the working-directory basename.

It derives short display lines from that data and stores per-session queue,
last-sent, dedupe, and auth-status state under
`~/.cache/pushtodisplay/claude-code/`. It does not store the full transcript.
The OAuth credentials themselves are handled by the `pushtodisplay` CLI, not by
the plugin; the plugin only caches whether auth is currently known to be good or
bad.

### Does it send data to services other than its declared connectors?

**No.** The plugin declares no MCP connectors and contacts no service other
than Push To Display:

- display updates go to `https://api.pushtodisplay.com` through the
  `pushtodisplay` CLI, authenticated with the user's Push To Display OAuth
  account;
- the OAuth device-code login uses `https://idp.pushtodisplay.com`;
- the plugin has no analytics, telemetry, crash reporting, advertising, or other
  network calls.

Push To Display's own infrastructure uses its published subprocessors (for
example Azure hosting); those are covered by the Push To Display privacy policy
linked below, not by the plugin's own code.

### How long is data kept?

- **Local plugin state:** under `~/.cache/pushtodisplay/claude-code/` until the
  user deletes it. Uninstalling the plugin does not automatically remove it.
- **Local credentials:** managed by the `pushtodisplay` CLI in the OS keychain,
  or in `~/.config/pushtodisplay/credentials.json` when no keychain is
  available, until logout or removal.
- **Board history:** stored by Push To Display under the user's account. The
  `/pushtodisplay:pushtodisplay-clear` command writes a marker; it does not
  delete board history.
- **Server-side payloads:** Push To Display stores display message payloads
  temporarily for delivery and may retain them in logs for up to 90 days. Account
  data is retained while the account is active; after account deletion,
  encrypted backups are purged within 30 days.

Source: [Push To Display privacy policy](https://pushtodisplay.com/privacy)
(effective 2026-04-14).

### Is the plugin intended for people under 18?

**No.** It is a developer tool for Claude Code users and their teams, and it is
not directed to children.

### Target audience

Developers and teams using Claude Code who want an ambient, shared status board
for agent activity. A user needs a Push To Display account and board, plus
Claude Code 2.1.x and Node.js 18+.

## Security-scan disclosure notes

- **Readable source.** The plugin is plain ESM JavaScript with JSDoc types. There
  is no build, minification, packing, dynamic `eval`, or obfuscation. Everything
  the hooks and commands run is committed in the plugin folder.
- **No hidden network behavior.** The only destinations are
  `https://api.pushtodisplay.com` (updates) and
  `https://idp.pushtodisplay.com` (OAuth login). The README discloses the data
  that leaves the machine and where it goes.
- **No runtime package downloads.** The plugin contains no package launcher. It
  uses the bundled `pushtodisplay` dependency or a binary already on `PATH`; if
  neither exists it reports an install error and stops.
- **Dependency install.** `package.json` and `package-lock.json` tell Claude Code
  to install the pinned `pushtodisplay` dependency at plugin-install time. This
  is expected to produce the **Dependencies install from a lockfile** reviewer
  hold. The lockfile is 41,095 bytes, below the 256 KiB per-file threshold, and
  is plain JSON.
- **Script structure.** `hooks/hook.mjs` imports shared modules from `lib/`,
  and each of the four commands runs `scripts/command.mjs` through a `!`…``
  dynamic-context line. The directory validator follows only plain shell
  scripts, so both the hook entry point and the command injections are expected
  to produce the **Scripts the validator couldn't follow** reviewer hold. The
  files are local, readable, and covered by tests. They are not inlined because
  the mapping, queue, state, and adapter logic is shared by the hooks, commands,
  and test suite.
- **No credential handling.** The plugin does not read or store OAuth tokens,
  API keys, or environment credentials. `PUSHTODISPLAY_CLI` is an optional
  executable path, not a secret.
- **Permission behavior.** `PermissionRequest` is observational only. The hook
  never emits allow/deny JSON, so Claude Code's normal permission prompt still
  applies.
- **No MCP surface.** There is no `.mcp.json`, no MCP server, no LSP server, and
  no bundled MCPB/DXT file.
- **Images.** `.claude-plugin/icon.png` is a complete 512x512 PNG used as the
  plugin icon. No command, hook, or script references it.

## Pre-submission checklist audit

Legend: **Pass** means the local check or a direct file inspection found no
problem. **Hold** means the directory may hold the version for a human reviewer
but does not block submission. **Portal** means only the developer portal can
decide it.

### Repository and folder layout

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Plugin folder contains `.claude-plugin/plugin.json` | Pass | Manifest is at the repository root. |
| Submit one plugin at a time | Pass | `marketplace.json` lists exactly one plugin, `pushtodisplay`. |
| Hooks/scripts and component paths stay inside the plugin folder | Pass | Hooks use `${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs`; commands use `${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs`; no `..` paths. |
| Regular files, no symlinks, submodules, or LFS pointers | Pass | `git ls-files` shows regular files only; no symlinks or `.gitattributes`. |
| No `.DS_Store`, `Thumbs.db`, `desktop.ini`, or `__MACOSX` | Pass | Filesystem scan found none. |
| Names valid on Windows and macOS | Pass | No colons, trailing dots/spaces, device names, or case-only collisions. |
| Folder names on the plugin path use safe characters | Pass | Repository path is `claude-code-pushtodisplay`. |
| No `export-ignore`/`export-subst` or content-rewriting git attributes | Pass | No `.gitattributes` file exists. |
| Repository under 50 MiB archived / 256 MiB unpacked; fewer than 10,000 files; each file under 5 MiB | Pass | 65 tracked files, about 240 KiB of tracked content; largest file is `package-lock.json` at 41,095 bytes. |

### Manifest and plugin name

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Name uses lowercase letters/digits/hyphens, starts and ends alphanumeric, at most 64 characters | Pass | `pushtodisplay`. |
| Name is distinctive, not a reserved word, and not presented as official | Pass | Product name `pushtodisplay`; no `claude`, `anthropic`, `official`, `plugin`, `mcp`, or `test` as the whole name. |
| Name is not already used by another organization's plugin | Portal | The portal's **Validate** performs the live name check. |
| Name/display name/author cannot be mistaken for another brand | Portal | `Push To Display` and `Goban Source LLC` are the owning product and company; the portal checks for conflicts. |
| Fork-specific name | Not applicable | This is not a fork. |
| `displayName` and `author.name` in one writing system | Pass | Both are ASCII. |
| Component keys spelled exactly and outside `experimental` | Pass | No `hooks` key in `plugin.json` (the hooks file loads automatically); no component keys under `experimental`. |
| `description`, `author`, and `version` set | Pass | All present in `plugin.json`; version is `0.1.1`. |

### README and license

| Checklist item | Result | Evidence |
| --- | --- | --- |
| README of at least 40 words in the plugin folder | Pass | `README.md` has about 1,490 words outside code blocks. |
| `LICENSE` file or `license` in `plugin.json` | Pass | MIT `LICENSE` file and `"license": "MIT"`. |

### Files in the plugin folder

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Every non-image/non-font file under 256 KiB | Pass | Largest non-image file is `package-lock.json` at 41,095 bytes; next is `README.md` at about 15 KiB. |
| 512 files or fewer | Pass | 65 tracked files. |
| Only text, SVG, complete PNG/JPEG/GIF/WebP, or font files | Pass | One complete 512x512 PNG icon; every other file is text. |
| README images use Markdown syntax and are not referenced from commands/hooks/scripts or code blocks | Pass | The README references no bundled image; the icon is not referenced by runtime code. |
| MCP servers declared with `command`/`args` or `url`, not `.mcpb`/`.dxt` | Not applicable | No MCP servers or bundles. |

### What the plugin runs and connects to

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Every package launcher is pinned to an exact version | Pass | No package launcher remains. The former unpinned fallback was removed; the plugin uses the bundled dependency or `PATH`. |
| No package-manager config that sets a registry/index/proxy/source | Pass | No `.npmrc`, `bunfig.toml`, or `uv.toml`. |
| No real credentials in files; credentials use `userConfig` with `sensitive: true` | Pass | No credentials or `userConfig` entries; OAuth is handled by the CLI and stored in the OS keychain. |
| Do not read a credential from the environment and send it | Pass | The plugin reads only `PUSHTODISPLAY_*` configuration; no token environment variables. |
| `.mcp.json` is valid and matches the MCP schema | Not applicable | No `.mcp.json`. |
| Remote MCP servers use `http`/`sse`/`ws` with an absolute HTTPS/WSS URL or `userConfig` reference | Not applicable | No remote MCP servers. |
| Local MCP servers start a plugin file with plain arguments, not a shell or `npm run` | Not applicable | No local MCP servers. |
| Hook/MCP command paths are written in full from `${CLAUDE_PLUGIN_ROOT}`, with no other variable, substitution, wildcard, or inline program | Pass | `hooks/hooks.json` uses exec form: `node` plus `${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs`. Command injections use `node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs <verb>`. |
| Keep launchers, package installs, other shell variables, command substitutions, and calls to other plugin files out of hook/MCP scripts | **Hold** | `hooks/hook.mjs` imports local `lib/*.mjs` modules. Expected finding: **Scripts the validator couldn't follow**. |
### Reviewer choices

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Pinned registry package launcher | Not applicable | No launcher is used. |
| Lockfile install | **Hold** | `package.json` + `package-lock.json`; kept deliberately so Claude Code installs the `pushtodisplay` dependency automatically. Expected finding: **Dependencies install from a lockfile**. |
| Program the validator cannot read through | **Hold** | The hook imports local modules, as above. Expected finding: **Scripts the validator couldn't follow**. |

### Hooks, commands, skills, and agents

| Checklist item | Result | Evidence |
| --- | --- | --- |
| `hooks/hooks.json` is valid JSON with a top-level `hooks` object and valid events/types | Pass | `claude plugin validate` passes; ten documented events are wired. |
| No `hooks/hooks.json` entry in `plugin.json`'s `hooks` field | Pass | The manifest has no `hooks` key. |
| Valid YAML front matter in each command with a single-text `description` | Pass | Four command files; validator passes. |
| Component folders and file names use the exact spelling and capitalization Claude Code expects | Pass | `hooks/`, `commands/`, `hooks/hooks.json`; no skills or agents. |

### Security-scan preparation

| Checklist item | Result | Evidence |
| --- | --- | --- |
| README describes everything the plugin runs, sends, or fetches | Pass | Hook table, data-egress list, destinations, credential handling, and retention are documented. |
| Source is readable, not compiled/packed/minified | Pass | Plain ESM and Markdown; no build artifacts. |

## Local verification

Run from the repository root:

```bash
npm ci
npm run check
claude plugin validate . --strict
claude plugin validate . --profile directory --strict
claude --plugin-dir . plugin details pushtodisplay
```

Expected/observed results:

- `npm run check`: typecheck, lint, and 123 tests pass.
- `claude plugin validate . --strict`: `Validation passed`.
- `claude plugin validate . --profile directory --strict`: `Validation passed`.
- `claude --plugin-dir . plugin details pushtodisplay`: 4 commands and 10 hook
  events, no agents, MCP servers, or LSP servers.

The repository marketplace was also exercised with an isolated `HOME`: the
repository was added as a local marketplace, `pushtodisplay@pushtodisplay` was
installed, and `claude plugin list` showed the plugin at version `0.1.1`.
Automatic dependency installation from the committed lockfile was verified
separately with `npm ci`; the local-path marketplace loads the plugin in place,
so Claude Code does not copy it or install its dependencies there.

## Lockfile tradeoff

The lockfile is **kept**.

Claude Code installs a plugin's Node.js dependencies only when the plugin root
contains both `package.json` and a supported lockfile. Removing
`package-lock.json` would therefore disable the automatic `pushtodisplay`
dependency install; marketplace users would need the CLI on `PATH` or would get
the (clear) "CLI not found" error. Keeping the lockfile is the correct tradeoff
for a plugin that depends on the CLI.

The lockfile was regenerated with npm 11, which removed 8,155 lines of extraneous
nested entries. It is now 41,095 bytes, so it no longer triggers the 256 KiB
per-file reviewer hold. It still triggers the intentional **Dependencies install
from a lockfile** hold. Use `npm ci` (not `npm install`) in a checkout to keep
the lockfile from re-adding those optional nested entries.

## Exact portal submission steps

These steps require the user's paid claude.ai account. They were not performed
here, and this packet does not claim they were.

1. Sign in to [claude.ai](https://claude.ai) with a Pro, Max, Ultra, Team, or
   Enterprise plan. On Team or Enterprise, use an Owner or a member with the
   **Directory** permission.
2. Connect the GitHub account that has push access to
   `pushtodisplay/claude-code-pushtodisplay` in the same Claude organization
   that should own the listing.
3. Open the developer portal at
   [claude.ai/directory/manage](https://claude.ai/directory/manage) (the short
   link is [clau.de/plugin-directory-submission](https://clau.de/plugin-directory-submission)).
4. Select **Submit new**, then **Plugin bundle**.
5. On the **Source** step:
   - **Repository:** `pushtodisplay/claude-code-pushtodisplay` or the full
     `https://github.com/pushtodisplay/claude-code-pushtodisplay` URL.
   - **Plugin path:** leave blank, because `.claude-plugin/plugin.json` is at the
     repository root. If the field requires a value, use `/` or `.`.
   - **Branch or tag:** `main`, or leave blank to follow the default branch
     (which is `main`).
6. Select **Validate**. The report applies to one commit. Expect no **Blocking**
   findings. Expect reviewer holds for **Dependencies install from a lockfile**
   and **Scripts the validator couldn't follow**. If the report shows any other
   finding, fix it, push, and select **Re-validate** on the same form.
7. On **Listing details**, confirm the name `pushtodisplay`, display name
   `Push To Display`, the description above, the MIT license, and the README
   body. The portal reads these from `plugin.json` and the README.
8. On **Data handling**, use the answers in
   [Data handling answers for the portal](#data-handling-answers-for-the-portal).
9. On **Compliance**, confirm the contact email is one Anthropic can use (the
   manifest uses `hello@pushtodisplay.com`) and select all four
   acknowledgements.
10. On **Review and submit**, confirm the details and choose how new versions
    arrive:
    - **GitHub push webhook** (default), or
    - **Scheduled check only**.
    Select **Submit for review**. Setting up the push webhook later requires
    repository admin access and is available under **Settings → Updates**.
11. After review, publish the passing version from the plugin page. Publishing
    requires the repository to stay public. The default setting is that an
    Anthropic reviewer publishes each version; the portal may instead grant
    first-version or automatic publishing.
12. After publishing, verify the listing appears in the directory and optionally
    confirm usage and version status on the plugin's **Usage** and **Versions**
    tabs.

## Remaining human actions

Only the user can:

- confirm the paid claude.ai plan and the correct organization role;
- connect the GitHub account with push access;
- run the portal **Validate** and **Submit for review** steps;
- answer the portal's acknowledgements and compliance questions;
- respond to reviewer questions or requested changes;
- publish the approved version;
- optionally configure the GitHub push webhook.

Do not change repository visibility: it is already public, which publishing
requires. Do not add npm publishing; distribution is the GitHub marketplace.
