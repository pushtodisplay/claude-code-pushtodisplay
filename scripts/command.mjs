#!/usr/bin/env node
/**
 * The implementation behind the `/pushtodisplay:*` commands.
 *
 * The Markdown command files run this script through Claude Code's dynamic
 * context injection (`!`...``), then ask Claude to relay the output. The script
 * always exits 0: a not-authenticated or offline board is a message to read, not
 * a reason to abort the command.
 *
 *   node scripts/command.mjs setup
 *   node scripts/command.mjs login
 *   node scripts/command.mjs status
 *   node scripts/command.mjs test
 *   node scripts/command.mjs clear
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { cacheDir, clock, labelFor, loadConfig } from "../lib/config.mjs";
import {
  PUSHTODISPLAY_CLI_VERSION,
  cliNotFoundMessage,
  isAuthFailure,
  probeAuth,
  resolveCli,
  sendPayload,
} from "../lib/cli-adapter.mjs";
import { bestDeviceUrl, parseDeviceAuth } from "../lib/device-code.mjs";
import {
  clearedMessage,
  payloadText,
  testMessage,
} from "../lib/messages.mjs";
import { isSetupComplete, markSetupComplete, setupPath } from "../lib/setup-state.mjs";
import { loginLog, writeAuth } from "../lib/state.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(SCRIPT_DIR, "login-worker.mjs");

/** How long setup waits for the browser login before asking the user to retry. */
const DEFAULT_LOGIN_TIMEOUT_MS = 90_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function print(text = "") {
  process.stdout.write(text + "\n");
}

function describeCli(cmd) {
  if (cmd.source === "bundled") return "bundled with the plugin";
  if (cmd.source === "path") return `PATH (${cmd.exe})`;
  if (cmd.source === "env") return `PUSHTODISPLAY_CLI (${cmd.exe})`;
  return "not found";
}

function boardLabel(boardId) {
  return boardId || "default board";
}

function loginTimeoutMs() {
  const configured = Number(process.env.PUSHTODISPLAY_LOGIN_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_LOGIN_TIMEOUT_MS;
}

/** Open a URL in the platform browser, best effort. */
function openBrowser(url) {
  const [exe, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    // A missing browser is not an error: the URL is printed anyway.
    child.on("error", () => {});
    child.unref();
  } catch {
    // No browser: the URL is printed anyway.
  }
}

/** Poll the login log until the URL/code appears or the timeout elapses. */
async function waitForDeviceAuth(logPath, timeoutMs) {
  const started = Date.now();
  let text = "";
  while (Date.now() - started < timeoutMs) {
    try {
      text = await readFile(logPath, "utf8");
    } catch {
      text = "";
    }
    const parsed = parseDeviceAuth(text);
    if (bestDeviceUrl(parsed) && parsed.code) return parsed;
    await sleep(100);
  }
  return parseDeviceAuth(text);
}

/**
 * Start the device-code login worker and print its URL/code. Returns
 * `authenticated` when no login was needed, `missing` when the bundled CLI is
 * absent, and `pending` while the worker waits for the browser.
 *
 * @returns {Promise<{status: "authenticated" | "missing" | "pending"}>}
 */
async function beginLogin() {
  const already = await probeAuth();
  if (already.ok) {
    print("Push To Display is already authenticated.");
    return { status: "authenticated" };
  }
  if (already.missing) {
    print(cliNotFoundMessage());
    return { status: "missing" };
  }

  const logPath = loginLog(process.env);
  await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  await writeFile(logPath, "", { encoding: "utf8", mode: 0o600 });

  const worker = spawn(process.execPath, [WORKER, logPath], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  worker.on("error", () => {});
  worker.unref();

  const parsed = await waitForDeviceAuth(logPath, 8000);
  const url = bestDeviceUrl(parsed);

  if (url) {
    openBrowser(url);
    print("Push To Display login started.");
    if (parsed.code) print(`Code: ${parsed.code}`);
    print(`Open: ${url}`);
    if (parsed.code) print("Enter the code in the browser, then approve the login.");
  } else {
    print("Push To Display login started, but the device code has not appeared yet.");
    print(`Check ${logPath} for the URL and code, then approve the login.`);
  }
  return { status: "pending" };
}

/** Wait until the CLI reports a valid login, or the timeout elapses. */
async function waitForLogin(timeoutMs) {
  const started = Date.now();
  for (;;) {
    if ((await probeAuth()).ok) return true;
    if (Date.now() - started >= timeoutMs) return false;
    await sleep(1000);
  }
}

async function login() {
  const started = await beginLogin();
  if (started.status === "pending") {
    print("Approve the login in the browser, then run /pushtodisplay:pushtodisplay-status.");
  } else if (started.status === "authenticated" && !isSetupComplete()) {
    print("Setup is not complete — run /pushtodisplay:pushtodisplay-setup.");
  }
}

/**
 * Full setup for this Claude Code integration: authenticate if needed, prove
 * the board works with a test entry, then write the per-integration marker.
 */
async function setup() {
  const config = loadConfig();
  if (config.disabled) {
    print(
      "Push To Display is disabled (PUSHTODISPLAY_DISABLED=1). Remove it and run /pushtodisplay:pushtodisplay-setup again.",
    );
    return;
  }

  let auth = await probeAuth();
  if (auth.missing) {
    print(cliNotFoundMessage());
    return;
  }

  if (!auth.ok) {
    const started = await beginLogin();
    if (started.status === "missing") return;
    if (started.status === "pending") {
      print("Waiting for the browser login to finish…");
      const ok = await waitForLogin(loginTimeoutMs());
      if (!ok) {
        print(
          "Login is still pending. Approve it in the browser, then run /pushtodisplay:pushtodisplay-setup again.",
        );
        return;
      }
      print("Logged in.");
    }
    auth = await probeAuth();
  }

  if (!auth.ok) {
    print("Not authenticated — setup did not complete.");
    return;
  }

  const agent = labelFor(process.env, process.cwd());
  const payload = testMessage({
    panelId: config.panel,
    agent,
    wall: clock(),
  });
  try {
    await sendPayload(payload, config.boardId);
  } catch (err) {
    if (isAuthFailure(err)) await writeAuth({ status: "bad", at: Date.now() });
    print(`Setup test entry failed: ${/** @type {Error} */ (err)?.message ?? err}`);
    print("Setup is not complete. Fix the error and run /pushtodisplay:pushtodisplay-setup again.");
    return;
  }

  const record = markSetupComplete(
    {
      boardId: config.boardId,
      panel: config.panel,
      label: agent,
      cliVersion: PUSHTODISPLAY_CLI_VERSION,
    },
    process.env,
  );
  // The test proved both auth and the board, so clear a stale known-bad cache.
  await writeAuth({ status: "ok", at: Date.now() });
  print(`Test entry sent to ${boardLabel(config.boardId)}, panel ${config.panel}, as ${agent}.`);
  print(
    `Setup complete for Claude Code. Board: ${boardLabel(record.boardId)}, panel ${record.panel}.`,
  );
}

async function status() {
  const config = loadConfig();
  const cmd = resolveCli();
  const auth = await probeAuth();
  const setup = isSetupComplete();
  await writeAuth({ status: auth.ok ? "ok" : "bad", at: Date.now() });

  print("Push To Display status");
  print(`  Auth: ${auth.ok ? "authenticated" : auth.missing ? "CLI not found" : "not authenticated"}`);
  print(`  Setup: ${setup ? "complete" : "not complete"}`);
  print(`  Setup file: ${setupPath()}`);
  print(`  CLI: ${describeCli(cmd)}`);
  print(`  Board: ${boardLabel(config.boardId)}`);
  print(`  Panel: ${config.panel}`);
  print(`  Label: ${labelFor(process.env, process.cwd())}`);
  print(`  Steps: ${config.steps ? "on" : "off"}`);
  print(`  Disabled: ${config.disabled ? "yes (PUSHTODISPLAY_DISABLED=1)" : "no"}`);
  print(`  Cache: ${cacheDir(process.env)}`);
  if (auth.missing) {
    print(`  ${cliNotFoundMessage()}`);
  } else if (!auth.ok && !setup) {
    print("  Run /pushtodisplay:pushtodisplay-setup to log in and finish setup.");
  } else if (!auth.ok) {
    print("  Run /pushtodisplay:pushtodisplay-login to authenticate.");
  } else if (!setup) {
    print("  Run /pushtodisplay:pushtodisplay-setup to finish setup.");
  }
}

async function test() {
  const config = loadConfig();
  if (config.disabled) {
    print("Push To Display is disabled (PUSHTODISPLAY_DISABLED=1).");
    return;
  }
  const auth = await probeAuth();
  if (!auth.ok) {
    await writeAuth({ status: "bad", at: Date.now() });
    print(
      auth.missing
        ? `Cannot send: ${cliNotFoundMessage()}`
        : isSetupComplete()
          ? "Not authenticated — run /pushtodisplay:pushtodisplay-login first."
          : "Not authenticated — run /pushtodisplay:pushtodisplay-setup first.",
    );
    return;
  }

  const agent = labelFor(process.env, process.cwd());
  const payload = testMessage({
    panelId: config.panel,
    agent,
    wall: clock(),
  });
  try {
    await sendPayload(payload, config.boardId);
    await writeAuth({ status: "ok", at: Date.now() });
    print(
      `Test entry sent to ${boardLabel(config.boardId)}, panel ${config.panel}, as ${agent}.`,
    );
    if (!isSetupComplete()) {
      print("Setup is not complete — run /pushtodisplay:pushtodisplay-setup to enable automatic updates.");
    }
  } catch (err) {
    if (isAuthFailure(err)) await writeAuth({ status: "bad", at: Date.now() });
    print(`Test entry failed: ${/** @type {Error} */ (err)?.message ?? err}`);
  }
}

async function clear() {
  const config = loadConfig();
  if (config.disabled) {
    print("Push To Display is disabled (PUSHTODISPLAY_DISABLED=1).");
    return;
  }
  const auth = await probeAuth();
  if (!auth.ok) {
    await writeAuth({ status: "bad", at: Date.now() });
    print(
      auth.missing
        ? `Cannot send: ${cliNotFoundMessage()}`
        : isSetupComplete()
          ? "Not authenticated — run /pushtodisplay:pushtodisplay-login first."
          : "Not authenticated — run /pushtodisplay:pushtodisplay-setup first.",
    );
    return;
  }

  const agent = labelFor(process.env, process.cwd());
  const payload = clearedMessage({
    panelId: config.panel,
    agent,
    wall: clock(),
  });
  try {
    await sendPayload(payload, config.boardId);
    await writeAuth({ status: "ok", at: Date.now() });
    print(`Wrote \`${payloadText(payload).trim()}\` to ${boardLabel(config.boardId)}.`);
  } catch (err) {
    if (isAuthFailure(err)) await writeAuth({ status: "bad", at: Date.now() });
    print(`Could not write the clear entry: ${/** @type {Error} */ (err)?.message ?? err}`);
  }
}

async function main() {
  const command = process.argv[2];
  switch (command) {
    case "setup":
      await setup();
      break;
    case "login":
      await login();
      break;
    case "status":
      await status();
      break;
    case "test":
      await test();
      break;
    case "clear":
      await clear();
      break;
    default:
      print("Usage: node scripts/command.mjs <setup|login|status|test|clear>");
  }
}

main().catch((err) => {
  // Commands always exit 0 so the injected output reaches Claude.
  print(`Push To Display command failed: ${/** @type {Error} */ (err)?.message ?? err}`);
});
