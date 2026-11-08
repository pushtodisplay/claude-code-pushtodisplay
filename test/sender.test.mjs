import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Sender,
  enqueue,
  fingerprint,
  trimQueue,
} from "../lib/sender.mjs";
import { createState } from "../lib/panel-state.mjs";

const msg = (text) => ({ panelId: 1, blocks: [{ text }] });

function recorder() {
  const sent = [];
  const at = [];
  const send = async (p) => {
    sent.push(p.blocks.map((b) => b.text).join(""));
    at.push(Date.now());
  };
  return { sent, at, send };
}

const NO_INTERVAL = 0;
const NO_BOUND = 1_000;
const ignore = () => {};

test("Sender sends entries in the order they happened", async () => {
  const { sent, send } = recorder();
  const s = new Sender(send, NO_INTERVAL, NO_BOUND, ignore);
  s.enqueue(msg("a"));
  s.enqueue(msg("b"));
  s.enqueue(msg("c"));
  await s.flush();
  assert.deepEqual(sent, ["a", "b", "c"]);
});

test("Sender suppresses consecutive duplicates but allows a repeat after another entry", async () => {
  const { sent, send } = recorder();
  const s = new Sender(send, NO_INTERVAL, NO_BOUND, ignore);
  s.enqueue(msg("same"));
  s.enqueue(msg("same"));
  s.enqueue(msg("other"));
  s.enqueue(msg("same"));
  await s.flush();
  assert.deepEqual(sent, ["same", "other", "same"]);
});

test("Sender does not collapse identical lines from different agents", async () => {
  const { sent, send } = recorder();
  const s = new Sender(send, NO_INTERVAL, NO_BOUND, ignore);
  s.enqueue(msg("release running npm test OK 11:04"));
  s.enqueue(msg("qa running npm test OK 11:04"));
  await s.flush();
  assert.equal(sent.length, 2);
});

test("Sender bounds the backlog by dropping the oldest steps, never results", async () => {
  const { sent, send } = recorder();
  const s = new Sender(send, NO_INTERVAL, 3, ignore);
  s.enqueue(msg("RESULT"), { urgent: true });
  for (let i = 0; i < 10; i++) s.enqueue(msg(`step ${i}`));
  await s.flush();
  assert.ok(sent.length <= 4);
  assert.ok(sent.includes("RESULT"));
  assert.ok(!sent.includes("step 0"));
  assert.equal(sent.at(-1), "step 9");
});

test("Sender spaces sends at least the configured interval apart", async () => {
  const { sent, at, send } = recorder();
  const s = new Sender(send, 60, NO_BOUND, ignore);
  s.enqueue(msg("a"));
  s.enqueue(msg("b"));
  await s.flush();
  assert.deepEqual(sent, ["a", "b"]);
  assert.ok(at[1] - at[0] >= 55);
});

test("Sender keeps going after a failed send and reports it once", async () => {
  const sent = [];
  const errors = [];
  let calls = 0;
  const s = new Sender(
    async (p) => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      sent.push(p.blocks[0].text);
    },
    NO_INTERVAL,
    NO_BOUND,
    (e) => errors.push(e),
  );
  s.enqueue(msg("a"));
  s.enqueue(msg("b"));
  await s.flush();
  assert.deepEqual(sent, ["b"]);
  assert.equal(errors.length, 1);
});

test("Sender drains everything queued while a flush is in progress", async () => {
  const { sent, send } = recorder();
  const s = new Sender(send, 20, NO_BOUND, ignore);
  s.enqueue(msg("a"));
  const flushed = s.flush();
  s.enqueue(msg("b"));
  s.enqueue(msg("c"));
  await flushed;
  await s.flush();
  assert.deepEqual(sent, ["a", "b", "c"]);
});

test("persistent enqueue dedupes consecutive entries and bounds the backlog", () => {
  const state = createState({ sessionId: "s", agent: "a", cwd: "/repo" });
  assert.equal(enqueue(state, msg("same")), true);
  assert.equal(enqueue(state, msg("same")), false);
  assert.equal(enqueue(state, msg("other")), true);
  assert.equal(enqueue(state, msg("same")), true);
  assert.deepEqual(state.queue.map((e) => e.payload.blocks[0].text), ["same", "other", "same"]);

  const bounded = createState({ sessionId: "s", agent: "a", cwd: "/repo" });
  enqueue(bounded, msg("RESULT"), { urgent: true, maxPending: 3 });
  for (let i = 0; i < 10; i++) enqueue(bounded, msg(`step ${i}`), { maxPending: 3 });
  assert.equal(bounded.queue.length, 3);
  assert.equal(bounded.queue[0].payload.blocks[0].text, "RESULT");
  assert.equal(bounded.queue.at(-1)?.payload.blocks[0].text, "step 9");
});

test("fingerprint ignores the panel but includes text and colour", () => {
  assert.equal(
    fingerprint({ panelId: 1, blocks: [{ text: "a", color: "#fff" }] }),
    fingerprint({ panelId: 2, blocks: [{ text: "a", color: "#fff" }] }),
  );
  assert.notEqual(
    fingerprint({ panelId: 1, blocks: [{ text: "a" }] }),
    fingerprint({ panelId: 1, blocks: [{ text: "b" }] }),
  );
});

test("trimQueue leaves urgent entries when everything is urgent", () => {
  const state = createState({ sessionId: "s", agent: "a", cwd: "/repo" });
  for (let i = 0; i < 5; i++) enqueue(state, msg(`u${i}`), { urgent: true, maxPending: 2 });
  trimQueue(state, 2);
  assert.equal(state.queue.length, 5);
});
