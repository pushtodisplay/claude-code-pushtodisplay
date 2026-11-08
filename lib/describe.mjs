/**
 * Human-readable, present-tense one-liners describing a tool call.
 *
 * The board is read from a distance by a person who does not know what a
 * "tool call" is, so everything here aims at plain language:
 *
 *   Bash       "npm test | head"          -> "running npm test"
 *   Read       "/Users/me/proj/src/a.ts"  -> "reading src/a.ts"
 *   Edit       {file_path, old_string…}   -> "editing src/a.ts (+8 −3)"
 *   WebSearch  {query: "claude hooks"}    -> "searching the web for claude hooks"
 *
 * Paths are shortened against the session cwd (then $HOME) because absolute
 * paths crowd out the part of the string that identifies the file.
 */
import * as path from "node:path";

import { truncate } from "./config.mjs";

/**
 * Longest tool description, in characters.
 *
 * A step line is `session description STATUS time`, which at `medium` runs
 * to ~35 characters per row — so a 48-character description keeps the whole
 * entry around two rows. Only tool descriptions are capped here; prompts and
 * results use the prose budget in `messages.mjs`.
 */
export const MAX_DESC = 48;

/**
 * @typedef {object} DescribeOpts
 * @property {string} [cwd] Session cwd — absolute paths inside it become relative.
 * @property {string} [home] Home directory override (defaults to $HOME).
 * @property {number} [max] Character budget for the description.
 */

/** @typedef {Record<string, unknown>} Args */

/** @param {unknown} args @returns {Args} */
const toArgs = (args) =>
  args && typeof args === "object" && !Array.isArray(args)
    ? /** @type {Args} */ (args)
    : {};

/** First non-empty string among `keys`. */
function str(a, keys) {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

/**
 * Shorten a path against the cwd, then $HOME.
 * @param {string} p
 * @param {DescribeOpts} [opts]
 */
export function shortenPath(p, opts = {}) {
  if (!p) return "";
  let out = p;
  const cwd = opts.cwd;
  if (cwd && path.isAbsolute(out)) {
    const rel = path.relative(cwd, out);
    if (rel === "") out = ".";
    else if (!rel.startsWith("..") && !path.isAbsolute(rel)) out = rel;
  }
  const home = opts.home ?? process.env.HOME ?? "";
  if (home && path.isAbsolute(out) && (out === home || out.startsWith(home + path.sep))) {
    out = "~" + out.slice(home.length);
  }
  // Still absolute (a temp dir, another volume): the leading directories are
  // pure noise on a 48-character line, so keep only what names the file.
  if (path.isAbsolute(out) && out !== "~") out = "…/" + path.basename(out);
  return out;
}

/** True for a path-like word in free text. */
function looksLikePath(part) {
  return part.startsWith("/") || /^[A-Za-z]:[\\/]/.test(part);
}

/**
 * Shorten any absolute paths inside free text.
 *
 * Prompts are pasted, not written: a user drops a temp-file path in, and 60
 * characters of UUID then occupy the whole panel. Only path-looking words are
 * touched, so prose and URLs survive.
 */
export function tidyText(text, opts = /** @type {DescribeOpts} */ ({})) {
  return String(text ?? "")
    .split(/(\s+)/)
    .map((part) => (looksLikePath(part) ? shortenPath(part, opts) : part))
    .join("");
}

/**
 * Reduce a shell command to the interesting part: drop the leading `cd` guard,
 * env assignments, redirections, and the boilerplate `| head`/`| tail` tail.
 */
export function cleanCommand(command) {
  const line =
    String(command ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  let c = line;
  c = c.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "");
  c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  c = c.replace(/\s*\|\s*(?:head|tail)(?:\s+-n?\s*\d+)?\s*$/, "");
  c = c.replace(/\s+2>&1\s*$/, "");
  c = c.replace(/\s+>+\s*\S+\s*$/, "");
  return c.replace(/\s+/g, " ").trim();
}

/**
 * A command too long to read keeps the program and its bare subcommand
 * (`git push`, `npm test`) and drops the arguments — at this width the arguments
 * are the part nobody reads.
 */
function summariseCommand(command, max = MAX_DESC) {
  if (command.length <= max - 8) return command;
  const words = command.split(" ").filter(Boolean);
  const program = words[0] ?? "";
  const sub = words[1] ?? "";
  // A subcommand is a short bare word: `test`, `push`, `run`. A long token is an
  // argument (a pattern, a hash) and would only be truncated later anyway.
  const bare = /^[A-Za-z][A-Za-z0-9:._-]*$/.test(sub) && sub.length <= 12;
  return bare ? `${program} ${sub}` : program;
}

/**
 * Fit a file name into a budget without losing its extension —
 * `pasted-image-2026110….png` still says what the file was.
 */
function fitName(name, budget) {
  if (name.length <= budget) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const room = Math.max(1, budget - 1 - ext.length);
  return name.slice(0, room) + "…" + ext;
}

const lineCount = (v) => (typeof v === "string" && v.length ? v.split("\n").length : 0);

/** "+N −M" for an edit, based on the replacement text it carries. */
function diffStat(a) {
  let added = 0;
  let removed = 0;
  const edits = Array.isArray(a.edits) ? a.edits : [];
  if (edits.length) {
    for (const raw of edits) {
      const edit = toArgs(raw);
      added += lineCount(edit.new_string ?? edit.newText ?? edit.content);
      removed += lineCount(edit.old_string ?? edit.oldText);
    }
  } else {
    added = lineCount(a.new_string ?? a.newText ?? a.content);
    removed = lineCount(a.old_string ?? a.oldText);
  }
  if (!added && !removed) return "";
  return ` (+${added} −${removed})`;
}

const PATH_VERBS = {
  read: "reading",
  write: "writing",
  edit: "editing",
  multiedit: "editing",
  notebookedit: "editing",
  create: "creating",
  delete: "deleting",
  move: "moving",
};

const PATH_KEYS = [
  "file_path",
  "filePath",
  "path",
  "file",
  "notebook_path",
  "target",
];

/** Lower-case, hyphen-free tool key used for mapping. */
const toolKey = (toolName) => String(toolName ?? "").toLowerCase();

/** Strip the scheme and any userinfo so a credential in a URL never hits the board. */
function displayUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/^https?:\/\//, "");
  } catch {
    return String(url).replace(/^https?:\/\//, "");
  }
}

/** Humanize an MCP tool name (`mcp__github__create_issue` -> `github: create issue`). */
function describeMcp(toolName, max) {
  const parts = String(toolName).split("__");
  const server = parts[1] || "mcp";
  const tool = (parts.slice(2).join("__") || "tool").replace(/_/g, " ");
  return truncate(`${server}: ${tool}`, max);
}

/** Build the display string for a tool call. Never empty. */
export function describeTool(toolName, args, opts = /** @type {DescribeOpts} */ ({})) {
  const max = opts.max ?? MAX_DESC;
  const a = toArgs(args);
  const rel = (p) => shortenPath(p, opts);
  const key = toolKey(toolName);
  const verb = PATH_VERBS[key];
  const p = str(a, PATH_KEYS);

  if (verb && p) {
    const stat = key === "edit" || key === "multiedit" ? diffStat(a) : "";
    const shown = rel(p);
    const slash = shown.lastIndexOf("/");
    const dir = slash >= 0 ? shown.slice(0, slash + 1) : "";
    const base = shown.slice(slash + 1);
    // Give up detail in a fixed order — the diff stat first, then the directory,
    // and only then abbreviate the file name, which keeps its extension.
    for (const candidate of [
      `${verb} ${shown}${stat}`,
      `${verb} ${shown}`,
      `${verb} ${base}${stat}`,
      `${verb} ${base}`,
    ]) {
      if (candidate.length <= max) return candidate;
    }
    const room = Math.max(4, max - verb.length - 1 - dir.length - stat.length);
    return `${verb} ${dir}${fitName(base, room)}${stat}`;
  }

  switch (key) {
    case "bash":
    case "shell":
    case "powershell": {
      const cmd = str(a, ["command", "cmd", "script"]);
      if (cmd) return truncate(`running ${summariseCommand(cleanCommand(cmd), max)}`, max);
      break;
    }
    case "grep":
    case "search": {
      const pattern = str(a, ["pattern", "query", "regex"]);
      const where = str(a, ["path", "glob", "include", "type"]);
      if (pattern) {
        return truncate(`searching for ${pattern}${where ? ` in ${rel(where)}` : ""}`, max);
      }
      break;
    }
    case "glob":
    case "find": {
      const pattern = str(a, ["pattern", "glob", "query"]);
      const where = str(a, ["path"]);
      if (pattern) {
        return truncate(`finding ${pattern}${where ? ` in ${rel(where)}` : ""}`, max);
      }
      break;
    }
    case "ls":
    case "list":
      return truncate(`listing ${rel(str(a, ["path", "dir", "directory"])) || "."}`, max);
    case "web_search":
    case "websearch": {
      const q = str(a, ["query", "q", "search"]);
      if (q) return truncate(`searching the web for ${q}`, max);
      break;
    }
    case "web_fetch":
    case "webfetch":
    case "fetch":
    case "curl": {
      const url = str(a, ["url", "uri", "href"]);
      if (url) return truncate(`fetching ${displayUrl(url)}`, max);
      break;
    }
    case "todo_write":
    case "todowrite":
    case "todo":
      return "updating the plan";
    case "task":
    case "agent": {
      const d = str(a, ["description", "prompt", "task"]);
      const type = str(a, ["subagent_type"]);
      return truncate(
        `delegating${d ? `: ${d}` : type ? ` to ${type}` : " to a subagent"}`,
        max,
      );
    }
    case "apply_patch":
      return "applying a patch";
    case "askuserquestion":
      return "asking you a question";
    case "exitplanmode":
      return "presenting a plan";
    case "enterplanmode":
      return "entering plan mode";
    case "skill": {
      const skill = str(a, ["skill", "name", "command"]);
      return truncate(`running skill${skill ? ` ${skill}` : ""}`, max);
    }
    case "slashcommand": {
      const command = str(a, ["command", "name"]).replace(/^\//, "");
      return truncate(`running /${command || "command"}`, max);
    }
    case "bashoutput":
      return "checking command output";
    case "killshell":
      return "stopping a background command";
    case "taskcreate":
      return "creating a task";
    case "taskupdate":
      return "updating a task";
    case "taskget":
      return "reading a task";
    case "tasklist":
      return "listing tasks";
    case "taskoutput":
      return "reading task output";
    case "taskstop":
      return "stopping a task";
    case "monitor": {
      const cmd = str(a, ["command", "cmd", "script"]);
      return truncate(`monitoring${cmd ? ` ${summariseCommand(cleanCommand(cmd), max - 11)}` : ""}`, max);
    }
    case "schedulewakeup":
      return "scheduling a wakeup";
    case "croncreate":
      return "scheduling a task";
    case "crondelete":
      return "removing a schedule";
    case "cronlist":
      return "listing schedules";
    case "subagenthandback":
      return "handing back to the parent";
    case "workflow":
      return "running a workflow";
    case "lsp":
      return "checking code intelligence";
  }

  if (key.startsWith("mcp__")) return describeMcp(toolName, max);

  // Generic fallback: keep the tool name visible, show what it was given.
  const keys = Object.keys(a).slice(0, 3);
  if (!keys.length) return String(toolName);
  const parts = keys.map((k) => `${k}: ${truncate(String(a[k]), 24)}`).join(", ");
  return truncate(`${toolName}(${parts})`, max);
}

/** The one argument that best explains a permission prompt. */
function permissionDetail(toolName, args, opts) {
  const a = toArgs(args);
  const rel = (p) => shortenPath(p, opts);
  const key = toolKey(toolName);
  switch (key) {
    case "bash":
    case "shell":
    case "powershell":
      return summariseCommand(cleanCommand(str(a, ["command", "cmd", "script"])));
    case "read":
    case "write":
    case "edit":
    case "multiedit":
    case "notebookedit":
      return rel(str(a, PATH_KEYS));
    case "grep":
    case "search":
      return str(a, ["pattern", "query", "regex"]);
    case "glob":
    case "find":
      return str(a, ["pattern", "glob", "query"]);
    case "web_fetch":
    case "webfetch":
    case "fetch":
      return displayUrl(str(a, ["url", "uri", "href"]));
    case "web_search":
    case "websearch":
      return str(a, ["query", "q", "search"]);
    case "task":
    case "agent":
      return str(a, ["description", "subagent_type", "prompt", "task"]);
    case "skill":
      return str(a, ["skill", "name", "command"]);
    case "slashcommand":
      return str(a, ["command", "name"]).replace(/^\//, "");
    case "monitor":
      return summariseCommand(cleanCommand(str(a, ["command", "cmd", "script"])));
  }
  if (key.startsWith("mcp__")) {
    const parts = String(toolName).split("__");
    return `${parts[1] || "mcp"}: ${(parts.slice(2).join("__") || "tool").replace(/_/g, " ")}`;
  }
  const first = Object.values(a).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? truncate(first, 32) : "";
}

/**
 * A blocking permission prompt, stated as the question the person must answer:
 *
 *   Allow Bash: git push --force-with-lease
 *   Allow Edit: src/auth.ts
 */
export function describePermission(toolName, args, opts = /** @type {DescribeOpts} */ ({})) {
  const max = opts.max ?? MAX_DESC;
  const detail = permissionDetail(toolName, args, opts);
  const name = String(toolName ?? "tool");
  return truncate(`Allow ${name}${detail ? `: ${detail}` : ""}`, max);
}
