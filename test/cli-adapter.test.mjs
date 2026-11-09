import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  authStatus,
  findOnPath,
  isAuthFailure,
  isCliMissing,
  probeAuth,
  resolveCli,
  runCli,
  sendArgs,
} from "../lib/cli-adapter.mjs";

function tempDir(prefix = "ptd-cli-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeExecutable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
  chmodSync(file, 0o755);
}

test("sendArgs maps a payload to CLI argv", () => {
  const payload = {
    panelId: 2,
    background: "#1a5276",
    density: "compact",
    blocks: [{ text: "hi", color: "#ffffff" }],
  };
  assert.deepEqual(sendArgs(payload, "board-1"), [
    "send",
    "-b",
    "board-1",
    "-p",
    "2",
    "--background",
    "#1a5276",
    "--density",
    "compact",
    "--block",
    '{"text":"hi","color":"#ffffff"}',
  ]);
});

test("sendArgs omits -b when no board is configured", () => {
  assert.deepEqual(sendArgs({ panelId: 1, blocks: [{ text: "x" }] }, ""), [
    "send",
    "-p",
    "1",
    "--block",
    '{"text":"x"}',
  ]);
});

test("sendArgs supports multiple blocks", () => {
  const args = sendArgs({ panelId: 1, blocks: [{ text: "a" }, { text: "b" }] }, "");
  assert.equal(args.filter((a) => a === "--block").length, 2);
});

test("resolveCli prefers PUSHTODISPLAY_CLI", () => {
  const cmd = resolveCli({ env: { PUSHTODISPLAY_CLI: "/opt/ptd" }, root: "/nowhere" });
  assert.equal(cmd.source, "env");
  assert.equal(cmd.exe, "/opt/ptd");
  assert.deepEqual(cmd.prefix, []);
});

test("resolveCli prefers the pinned vendored CLI over PATH", () => {
  const { dir, cleanup } = tempDir("ptd-vendor-");
  try {
    const pkgRoot = path.join(dir, "vendor", "pushtodisplay");
    mkdirSync(path.join(pkgRoot, "dist"), { recursive: true });
    writeFileSync(path.join(pkgRoot, "dist", "cli.js"), "// cli\n");
    writeFileSync(
      path.join(pkgRoot, "package.json"),
      JSON.stringify({
        name: "pushtodisplay",
        version: "0.1.19",
        bin: { pushtodisplay: "./dist/cli.js" },
      }),
    );
    const pathDir = path.join(dir, "bin");
    writeExecutable(path.join(pathDir, "pushtodisplay"), "#!/bin/sh\nexit 0\n");

    const cmd = resolveCli({ env: { PATH: pathDir }, root: dir });
    assert.equal(cmd.source, "bundled");
    assert.equal(cmd.exe, process.execPath);
    assert.deepEqual(cmd.prefix, [path.join(pkgRoot, "dist", "cli.js")]);
  } finally {
    cleanup();
  }
});

test("resolveCli uses a bundled npm dependency when present", () => {
  const { dir, cleanup } = tempDir("ptd-bundled-");
  try {
    const pkgDir = path.join(dir, "node_modules", "pushtodisplay");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pushtodisplay", bin: { pushtodisplay: "./dist/cli.js" } }),
    );
    mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
    writeFileSync(path.join(pkgDir, "dist", "cli.js"), "#!/usr/bin/env node\n");
    const cmd = resolveCli({ env: {}, root: dir });
    assert.equal(cmd.source, "bundled");
    assert.equal(cmd.exe, process.execPath);
    assert.deepEqual(cmd.prefix, [path.join(pkgDir, "dist", "cli.js")]);
  } finally {
    cleanup();
  }
});

test("resolveCli falls back to PATH and reports a missing CLI without a launcher", () => {
  const { dir, cleanup } = tempDir("ptd-path-");
  try {
    const exe = path.join(dir, "pushtodisplay");
    writeExecutable(exe, "#!/bin/sh\nexit 0\n");
    assert.equal(findOnPath("pushtodisplay", dir), exe);
    const cmd = resolveCli({ env: { PATH: dir }, root: "/nowhere" });
    assert.equal(cmd.source, "path");
    assert.equal(cmd.exe, exe);

    const missing = resolveCli({ env: { PATH: "/definitely/not/here" }, root: "/nowhere" });
    assert.equal(missing.source, "missing");
    assert.equal(missing.exe, "");
    assert.deepEqual(missing.prefix, []);
  } finally {
    cleanup();
  }
});

test("runCli reports a missing CLI as ENOENT and never spawns a package launcher", async () => {
  const result = await runCli(["auth", "status", "--json"], {
    env: { PATH: "/definitely/not/here" },
    root: "/nowhere",
  });
  assert.equal(result.code, 1);
  assert.equal(/** @type {NodeJS.ErrnoException} */ (result.error)?.code, "ENOENT");
  assert.match(result.stderr, /CLI not found/);
});

/** Create a fake CLI that answers auth status from FAKE_AUTH and exits. */
function fakeAuthCli(dir, status) {
  const file = path.join(dir, "pushtodisplay");
  const body = `#!/usr/bin/env node
const status = ${JSON.stringify(status)};
if (process.argv.slice(2).join(" ") === "auth status --json") {
  process.stdout.write(JSON.stringify({ authenticated: status === "ok" }) + "\\n");
  process.exit(status === "ok" ? 0 : 1);
}
process.exit(0);
`;
  writeExecutable(file, body);
  return file;
}

test("probeAuth reads JSON status and treats a non-zero exit as unauthenticated", async () => {
  const { dir, cleanup } = tempDir("ptd-auth-");
  try {
    const ok = fakeAuthCli(dir, "ok");
    assert.deepEqual(await probeAuth({ env: { PUSHTODISPLAY_CLI: ok } }), {
      ok: true,
      missing: false,
    });

    const bad = fakeAuthCli(dir, "bad");
    assert.deepEqual(await probeAuth({ env: { PUSHTODISPLAY_CLI: bad } }), {
      ok: false,
      missing: false,
    });
    assert.equal(await authStatus({ env: { PUSHTODISPLAY_CLI: bad } }), false);
  } finally {
    cleanup();
  }
});

test("probeAuth falls back to legacy text heuristics", async () => {
  const { dir, cleanup } = tempDir("ptd-legacy-");
  try {
    const file = path.join(dir, "pushtodisplay");
    writeExecutable(
      file,
      `#!/usr/bin/env node
process.stdout.write("Auth method: OAuth (JWT)\\nAll commands available (send, boards, devices).\\n");
process.exit(0);
`,
    );
    assert.equal(await authStatus({ env: { PUSHTODISPLAY_CLI: file } }), true);

    writeExecutable(
      file,
      `#!/usr/bin/env node
process.stdout.write("Not authenticated. Run \\\`pushtodisplay auth login\\\`.\\n");
process.exit(0);
`,
    );
    assert.equal(await authStatus({ env: { PUSHTODISPLAY_CLI: file } }), false);
  } finally {
    cleanup();
  }
});

test("probeAuth reports a missing CLI", async () => {
  const result = await probeAuth({ env: { PUSHTODISPLAY_CLI: "/definitely/missing/ptd" } });
  assert.equal(result.ok, false);
  assert.equal(result.missing, true);
});

test("error classification", () => {
  assert.equal(isAuthFailure(new Error("401 Unauthorized")), true);
  assert.equal(isAuthFailure(new Error("403 Forbidden")), true);
  assert.equal(isAuthFailure(new Error("unauthorized")), true);
  assert.equal(isAuthFailure(new Error("ECONNREFUSED")), false);
  assert.equal(isCliMissing(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })), true);
  assert.equal(isCliMissing(new Error("spawn ENOENT")), false);
});
