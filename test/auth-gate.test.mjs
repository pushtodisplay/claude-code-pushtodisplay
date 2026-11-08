import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { AuthGate, authAllowed, recheckAuth, revokeAuth } from "../lib/auth-gate.mjs";
import { readAuth, writeAuth } from "../lib/state.mjs";

function tempEnv() {
  const home = mkdtempSync(path.join(tmpdir(), "ptd-auth-"));
  return {
    env: { HOME: home },
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** A probe whose answer we control, and that we can leave pending. */
function controllable() {
  let resolve;
  let started = 0;
  const probe = () => {
    started += 1;
    return new Promise((r) => {
      resolve = r;
    });
  };
  return {
    probe,
    get started() {
      return started;
    },
    answer: (v) => resolve(v),
  };
}

test("AuthGate waits for an in-flight probe instead of dropping the message", async () => {
  const p = controllable();
  const gate = new AuthGate(p.probe, 20_000);

  void gate.start();
  const permitted = gate.allowed();

  let decided = false;
  void permitted.then(() => (decided = true));
  await Promise.resolve();
  assert.equal(decided, false);

  p.answer(true);
  assert.equal(await permitted, true);
  assert.equal(gate.authenticated, true);
});

test("AuthGate sends immediately once authenticated", async () => {
  const p = controllable();
  const gate = new AuthGate(p.probe, 20_000);
  void gate.start();
  p.answer(true);
  await gate.start();
  assert.equal(await gate.allowed(), true);
  assert.equal(p.started, 1);
});

test("AuthGate does not re-ask within the interval after a failed probe", async () => {
  let now = 1_000;
  const p = controllable();
  const gate = new AuthGate(p.probe, 20_000, () => now);

  void gate.start();
  p.answer(false);
  await gate.start();
  assert.equal(gate.authenticated, false);
  assert.equal(await gate.allowed(), false);
  assert.equal(p.started, 1);

  now += 25_000;
  const retry = gate.allowed();
  assert.equal(p.started, 2);
  p.answer(true);
  assert.equal(await retry, true);
});

test("persistent gate probes when auth is unknown, then caches the answer", async () => {
  const { env, cleanup } = tempEnv();
  try {
    let probes = 0;
    const probe = async () => {
      probes += 1;
      return true;
    };
    assert.equal(await authAllowed({ env, probe }), true);
    assert.equal(probes, 1);
    assert.equal((await readAuth(env))?.status, "ok");
    assert.equal(await authAllowed({ env, probe }), true);
    assert.equal(probes, 1);
  } finally {
    cleanup();
  }
});

test("persistent gate drops while known-bad and re-probes after the interval", async () => {
  const { env, cleanup } = tempEnv();
  try {
    let now = 1_000;
    let probes = 0;
    let answer = false;
    const probe = async () => {
      probes += 1;
      return answer;
    };
    assert.equal(await authAllowed({ env, probe, now: () => now }), false);
    assert.equal(probes, 1);

    assert.equal(await authAllowed({ env, probe, now: () => now }), false);
    assert.equal(probes, 1, "known-bad must not re-ask within the interval");

    now += 20_001;
    answer = true;
    assert.equal(await authAllowed({ env, probe, now: () => now }), true);
    assert.equal(probes, 2);
    assert.equal((await readAuth(env))?.status, "ok");
  } finally {
    cleanup();
  }
});

test("revoke and recheck flip the persistent gate", async () => {
  const { env, cleanup } = tempEnv();
  try {
    await writeAuth({ status: "ok", at: Date.now() }, env);
    await revokeAuth(env);
    assert.equal((await readAuth(env))?.status, "bad");
    assert.equal(await recheckAuth(async () => true, env), true);
    assert.equal((await readAuth(env))?.status, "ok");
  } finally {
    cleanup();
  }
});
