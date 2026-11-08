import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeoutMs = 10_000, intervalMs = 50) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await sleep(intervalMs);
  }
}

/** Copy the runtime (hooks + lib) to a temp dir without node_modules. */
function makeRuntime() {
  const dir = mkdtempSync(path.join(tmpdir(), "ptd-runtime-"));
  cpSync(path.join(pluginRoot, "hooks"), path.join(dir, "hooks"), { recursive: true });
  cpSync(path.join(pluginRoot, "lib"), path.join(dir, "lib"), { recursive: true });
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const cli = path.join(bin, "pushtodisplay");
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ at: Date.now(), args }) + "\\n");
const auth = process.env.FAKE_CLI_AUTH || "ok";
if (args[0] === "auth" && args[1] === "status") {
  const ok = auth === "ok";
  process.stdout.write(JSON.stringify({ authenticated: ok }) + "\\n");
  process.exit(ok ? 0 : 1);
}
process.exit(0);
`,
    "utf8",
  );
  chmodSync(cli, 0o755);
  return { dir, bin, cli };
}

const runtime = makeRuntime();
after(() => rmSync(runtime.dir, { recursive: true, force: true }));

function makeEnv(extra = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "ptd-home-"));
  const log = path.join(home, "cli.log");
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${runtime.bin}${path.delimiter}${process.env.PATH ?? ""}`,
    FAKE_CLI_LOG: log,
    FAKE_CLI_AUTH: "ok",
    PUSHTODISPLAY_LABEL: "demo",
    ...extra,
  };
  return {
    home,
    log,
    env,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function runHook(event, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(runtime.dir, "hooks", "hook.mjs")], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(event));
  });
}

function calls(log) {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sends(log) {
  return calls(log).filter((call) => call.args[0] === "send");
}

function lines(log) {
  return sends(log).map((call) => {
    const blocks = [];
    for (let i = 0; i < call.args.length; i++) {
      if (call.args[i] === "--block") blocks.push(JSON.parse(call.args[i + 1]));
    }
    return blocks.map((b) => b.text).join("");
  });
}

const sessionStart = {
  session_id: "s1",
  cwd: "/repo",
  hook_event_name: "SessionStart",
  source: "startup",
};

test("SessionStart writes a READY line and per-session state", async () => {
  const h = makeEnv();
  try {
    const result = await runHook(sessionStart, h.env);
    assert.equal(result.code, 0);
    await waitFor(() => sends(h.log).length === 1);
    assert.match(lines(h.log)[0], /^demo session opened READY \d{2}:\d{2}$/);

    const stateFile = path.join(h.home, ".cache", "pushtodisplay", "claude-code", "s1.json");
    assert.ok(existsSync(stateFile));
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(state.sessionId, "s1");
    assert.equal(state.agent, "demo");
    assert.equal(state.queue.length, 0);
  } finally {
    h.cleanup();
  }
});

test("env config reaches the CLI argv", async () => {
  const h = makeEnv({
    PUSHTODISPLAY_PANEL: "2",
    PUSHTODISPLAY_BOARD_ID: "board-1",
    PUSHTODISPLAY_LABEL: "release",
  });
  try {
    await runHook(sessionStart, h.env);
    await waitFor(() => sends(h.log).length === 1);
    const call = sends(h.log)[0];
    assert.ok(call.args.includes("-b"));
    assert.equal(call.args[call.args.indexOf("-b") + 1], "board-1");
    assert.equal(call.args[call.args.indexOf("-p") + 1], "2");
    assert.match(lines(h.log)[0], /^release session opened READY /);
  } finally {
    h.cleanup();
  }
});

test("PostToolUse posts a finished step and suppresses a consecutive duplicate", async () => {
  const h = makeEnv();
  const event = {
    session_id: "s1",
    cwd: "/repo",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
  };
  try {
    await runHook(event, h.env);
    await waitFor(() => sends(h.log).length === 1);
    assert.match(lines(h.log)[0], /^demo running npm test OK \d{2}:\d{2}$/);

    await runHook(event, h.env);
    await sleep(400);
    assert.equal(sends(h.log).length, 1, "consecutive duplicate must be suppressed");
  } finally {
    h.cleanup();
  }
});

test("Stop flushes synchronously and ends with the quoted assistant message", async () => {
  const h = makeEnv();
  try {
    await runHook(sessionStart, h.env);
    await waitFor(() => sends(h.log).length === 1);

    const result = await runHook(
      {
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: "All tests pass. The clock is deterministic now.",
      },
      h.env,
    );
    assert.equal(result.code, 0);
    const sent = lines(h.log);
    assert.equal(sent.length, 2);
    assert.match(sent[0], /session opened READY/);
    assert.match(sent[1], /^demo All tests pass\. DONE \d{2}:\d{2}$/);
  } finally {
    h.cleanup();
  }
});

test("PermissionRequest logs NEEDS without returning a permission decision", async () => {
  const h = makeEnv();
  try {
    const result = await runHook(
      {
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "git push --force-with-lease" },
      },
      h.env,
    );
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), "", "must not return allow/deny JSON");
    await waitFor(() => sends(h.log).length === 1);
    assert.match(
      lines(h.log)[0],
      /^demo Allow Bash: git push --force-with-lease NEEDS \d{2}:\d{2}$/,
    );
  } finally {
    h.cleanup();
  }
});

test("StopFailure posts the provider error as FAIL", async () => {
  const h = makeEnv();
  try {
    await runHook(
      {
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "StopFailure",
        error: "rate_limit",
        error_details: "429 Too Many Requests",
      },
      h.env,
    );
    await waitFor(() => sends(h.log).length === 1);
    assert.match(lines(h.log)[0], /^demo 429 Too Many Requests FAIL \d{2}:\d{2}$/);
  } finally {
    h.cleanup();
  }
});

test("SessionEnd posts ENDED", async () => {
  const h = makeEnv();
  try {
    const result = await runHook(
      {
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "SessionEnd",
        reason: "prompt_input_exit",
      },
      h.env,
    );
    assert.equal(result.code, 0);
    await waitFor(() => sends(h.log).length === 1);
    assert.match(lines(h.log)[0], /^demo session closed ENDED \d{2}:\d{2}$/);
  } finally {
    h.cleanup();
  }
});

test("PUSHTODISPLAY_STEPS=0 drops tool steps but keeps milestones", async () => {
  const h = makeEnv({ PUSHTODISPLAY_STEPS: "0" });
  try {
    await runHook(
      {
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      },
      h.env,
    );
    await sleep(400);
    assert.equal(sends(h.log).length, 0);

    await runHook(sessionStart, h.env);
    await waitFor(() => sends(h.log).length === 1);
    assert.match(lines(h.log)[0], /session opened READY/);
  } finally {
    h.cleanup();
  }
});

test("PUSHTODISPLAY_DISABLED=1 does nothing", async () => {
  const h = makeEnv({ PUSHTODISPLAY_DISABLED: "1" });
  try {
    await runHook(sessionStart, h.env);
    await sleep(400);
    assert.equal(sends(h.log).length, 0);
    const stateFile = path.join(h.home, ".cache", "pushtodisplay", "claude-code", "s1.json");
    assert.equal(existsSync(stateFile), false);
  } finally {
    h.cleanup();
  }
});

test("known-bad auth drops updates, then a lazy re-probe re-enables them", async () => {
  const h = makeEnv({ FAKE_CLI_AUTH: "bad" });
  try {
    await runHook(sessionStart, h.env);
    await waitFor(() => {
      const authFile = path.join(h.home, ".cache", "pushtodisplay", "claude-code", "auth.json");
      if (!existsSync(authFile)) return false;
      return JSON.parse(readFileSync(authFile, "utf8")).status === "bad";
    });
    await sleep(300);
    assert.equal(sends(h.log).length, 0);

    // Make the cached "bad" old enough that the next event re-probes.
    const authFile = path.join(h.home, ".cache", "pushtodisplay", "claude-code", "auth.json");
    writeFileSync(authFile, JSON.stringify({ status: "bad", at: 0 }) + "\n");

    const env = { ...h.env, FAKE_CLI_AUTH: "ok" };
    await runHook(
      {
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "UserPromptSubmit",
        prompt: "fix the flaky test",
      },
      env,
    );
    await waitFor(() => sends(h.log).length === 1);
    assert.match(lines(h.log)[0], /^demo fix the flaky test RUN \d{2}:\d{2}$/);
  } finally {
    h.cleanup();
  }
});

test("SessionStart warns when the cached auth state is bad", async () => {
  const h = makeEnv();
  try {
    const authDir = path.join(h.home, ".cache", "pushtodisplay", "claude-code");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      path.join(authDir, "auth.json"),
      JSON.stringify({ status: "bad", at: Date.now() }) + "\n",
    );
    const result = await runHook(sessionStart, h.env);
    assert.match(result.stdout, /not authenticated/i);
    assert.match(result.stdout, /pushtodisplay-login/);
  } finally {
    h.cleanup();
  }
});

test("queued steps are sent in order with at least 1.2s spacing", async () => {
  const h = makeEnv();
  try {
    const base = {
      session_id: "s1",
      cwd: "/repo",
      hook_event_name: "PostToolUse",
    };
    await runHook(
      { ...base, tool_name: "Bash", tool_input: { command: "npm test" } },
      h.env,
    );
    await runHook(
      { ...base, tool_name: "Bash", tool_input: { command: "npm run lint" } },
      h.env,
    );
    await waitFor(() => sends(h.log).length === 2, 10_000);

    const sent = sends(h.log);
    assert.match(lines(h.log)[0], /running npm test OK/);
    assert.match(lines(h.log)[1], /running npm run lint OK/);
    assert.ok(
      sent[1].at - sent[0].at >= 1150,
      `sends were ${sent[1].at - sent[0].at}ms apart`,
    );
  } finally {
    h.cleanup();
  }
});

test("SessionEnd alone is delivered within its tight budget", async () => {
  const h = makeEnv();
  try {
    const started = Date.now();
    await runHook(
      {
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "SessionEnd",
        reason: "other",
      },
      h.env,
    );
    await waitFor(() => sends(h.log).length === 1, 5_000);
    assert.ok(Date.now() - started < 5_000);
  } finally {
    h.cleanup();
  }
});
