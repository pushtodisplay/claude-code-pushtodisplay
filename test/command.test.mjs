/** The `/pushtodisplay:*` command implementation against a fake CLI. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isSetupComplete, markSetupComplete } from "../lib/setup-state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const script = path.join(repoRoot, "scripts", "command.mjs");

const FAKE_CLI = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const statePath = process.env.FAKE_PTD_STATE;
function auth() {
  if (statePath && fs.existsSync(statePath)) return fs.readFileSync(statePath, "utf8").trim();
  return process.env.FAKE_PTD_AUTH === "0" ? "bad" : "ok";
}
if (args[0] === "auth" && args[1] === "status") {
  const ok = auth() === "ok";
  process.stdout.write(JSON.stringify({ authenticated: ok, method: ok ? "oauth" : null }) + "\\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "login") {
  process.stdout.write("Visit https://example.com/device and enter code ABCD-1234\\n");
  if (process.env.FAKE_PTD_LOGIN_OK !== "0") {
    if (statePath) fs.writeFileSync(statePath, "ok\\n");
    process.exit(0);
  }
  process.exit(2);
}
if (args[0] === "send") {
  if (process.env.FAKE_PTD_FAIL_SEND === "1") {
    process.stderr.write("send failed\\n");
    process.exit(1);
  }
  fs.appendFileSync(process.env.FAKE_PTD_LOG, JSON.stringify({ args, at: Date.now() }) + "\\n");
  process.exit(0);
}
process.exit(0);
`;

/**
 * @param {{setup?: boolean, auth?: boolean}} [opts]
 */
function createHarness(opts = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ptd-command-"));
  const home = path.join(root, "home");
  const cache = path.join(root, "cache");
  const log = path.join(root, "sent.jsonl");
  const authState = path.join(root, "auth-state");
  const fake = path.join(root, "pushtodisplay");

  mkdirSync(home, { recursive: true });
  mkdirSync(cache, { recursive: true });
  writeFileSync(fake, FAKE_CLI);
  chmodSync(fake, 0o755);
  writeFileSync(authState, opts.auth === false ? "bad\n" : "ok\n");

  const env = {
    ...process.env,
    HOME: home,
    PUSHTODISPLAY_CACHE_DIR: cache,
    PUSHTODISPLAY_CLI: fake,
    FAKE_PTD_STATE: authState,
    FAKE_PTD_LOG: log,
  };
  if (opts.setup !== false) markSetupComplete({}, env);

  return {
    root,
    cache,
    env,
    /**
     * @param {string[]} args
     * @param {Record<string, string>} [overrides]
     */
    run(args, overrides = {}) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], {
          env: { ...env, ...overrides },
          stdio: ["ignore", "pipe", "pipe"],
        });
        /** @type {Buffer[]} */
        const out = [];
        /** @type {Buffer[]} */
        const err = [];
        child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
        child.on("error", reject);
        child.on("close", (code) =>
          resolve({
            code,
            stdout: Buffer.concat(out).toString("utf8"),
            stderr: Buffer.concat(err).toString("utf8"),
          }),
        );
      });
    },
    /** @returns {{args: string[], at: number}[]} */
    entries() {
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** @param {{args: string[]}} entry */
function line(entry) {
  /** @type {{text: string}[]} */
  const blocks = [];
  for (let i = 0; i < entry.args.length; i += 1) {
    if (entry.args[i] === "--block") blocks.push(JSON.parse(entry.args[i + 1]));
  }
  return blocks.map((block) => block.text).join("");
}

test("setup sends one test entry and writes the Claude Code setup marker", async () => {
  const harness = createHarness({ setup: false });
  try {
    const result = await harness.run(["setup"], {
      PUSHTODISPLAY_PANEL: "2",
      PUSHTODISPLAY_LABEL: "ci",
      PUSHTODISPLAY_BOARD_ID: "board-9",
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Setup complete for Claude Code/);
    const entries = harness.entries();
    assert.equal(entries.length, 1);
    assert.match(line(entries[0]), /^ci link OK, panel 2 OK \d{2}:\d{2}$/);
    assert.equal(entries[0].args[entries[0].args.indexOf("-b") + 1], "board-9");
    assert.equal(isSetupComplete(harness.env), true);
    const auth = JSON.parse(readFileSync(path.join(harness.cache, "auth.json"), "utf8"));
    assert.equal(auth.status, "ok");
  } finally {
    harness.cleanup();
  }
});

test("setup logs in first when the account is not authenticated", async () => {
  const harness = createHarness({ setup: false, auth: false });
  try {
    const result = await harness.run(["setup"], {
      FAKE_PTD_LOGIN_OK: "1",
      PUSHTODISPLAY_LOGIN_TIMEOUT_MS: "5000",
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /login started/i);
    assert.match(result.stdout, /Setup complete for Claude Code/);
    assert.equal(harness.entries().length, 1);
    assert.equal(isSetupComplete(harness.env), true);
  } finally {
    harness.cleanup();
  }
});

test("setup does not write the marker when the test entry fails", async () => {
  const harness = createHarness({ setup: false });
  try {
    const result = await harness.run(["setup"], { FAKE_PTD_FAIL_SEND: "1" });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Setup is not complete/);
    assert.equal(harness.entries().length, 0);
    assert.equal(isSetupComplete(harness.env), false);
  } finally {
    harness.cleanup();
  }
});

test("setup does not write the marker when login never completes", async () => {
  const harness = createHarness({ setup: false, auth: false });
  try {
    const result = await harness.run(["setup"], {
      FAKE_PTD_LOGIN_OK: "0",
      PUSHTODISPLAY_LOGIN_TIMEOUT_MS: "0",
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Login is still pending/);
    assert.equal(harness.entries().length, 0);
    assert.equal(isSetupComplete(harness.env), false);
  } finally {
    harness.cleanup();
  }
});

test("re-authentication leaves an existing setup marker in place", async () => {
  const harness = createHarness({ setup: true, auth: false });
  try {
    const result = await harness.run(["login"], { FAKE_PTD_LOGIN_OK: "1" });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /login started/i);
    assert.equal(isSetupComplete(harness.env), true);
  } finally {
    harness.cleanup();
  }
});

test("status reports the missing setup marker and the setup command", async () => {
  const harness = createHarness({ setup: false });
  try {
    const result = await harness.run(["status"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Setup: not complete/);
    assert.match(result.stdout, /\/pushtodisplay:pushtodisplay-setup/);
  } finally {
    harness.cleanup();
  }
});
