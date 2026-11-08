import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockedMessage,
  clearedMessage,
  doneMessage,
  errorMessage,
  payloadText,
  permissionMessage,
  sessionClosedMessage,
  sessionOpenedMessage,
  stepMessage,
  subagentFinishedMessage,
  subagentStartedMessage,
  taskMessage,
  testMessage,
} from "../lib/messages.mjs";
import {
  ACCENT,
  STATUS_COLOR,
  SURFACE,
  TEXT,
  TEXT_DIM,
} from "../lib/payloads.mjs";

const WALL = "11:04:22";
const AGENT = "release";

const build = {
  opened: sessionOpenedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  closed: sessionClosedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  task: taskMessage({ panelId: 1, agent: AGENT, wall: WALL, task: "fix the flaky test" }),
  stepOk: stepMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    toolName: "Bash",
    args: { command: "npm test" },
    cwd: "/repo",
    ok: true,
  }),
  stepFailed: stepMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    toolName: "Bash",
    args: { command: "npm test" },
    cwd: "/repo",
    ok: false,
  }),
  done: doneMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    text: "Pinned the clock so the release test is deterministic. No other changes.",
  }),
  blocked: blockedMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    kind: "confirm",
    title: "Allow bash?",
  }),
  permission: permissionMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    toolName: "Bash",
    args: { command: "git push --force-with-lease" },
  }),
  error: errorMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    detail: "provider returned 500",
  }),
  subagentStart: subagentStartedMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    agentType: "Explore",
  }),
  subagentStop: subagentFinishedMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    agentType: "Explore",
  }),
  test: testMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  cleared: clearedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
};

test("every message is four inline runs on one surface", () => {
  for (const p of Object.values(build)) {
    assert.equal(p.background, SURFACE);
    assert.equal(p.blocks.length, 4);
    for (const block of p.blocks) {
      assert.deepEqual(Object.keys(block).sort(), ["color", "text"]);
    }
    assert.ok(payloadText(p).startsWith(`${AGENT} `));
    assert.match(payloadText(p), / [A-Z]+ 11:04$/);
    assert.ok(!/[·🎯▸◐✓✕🏁✅◌•]/u.test(payloadText(p)));
  }
});

test("every message colours name, body, status, and time apart", () => {
  for (const p of Object.values(build)) {
    assert.equal(p.blocks[0].color, ACCENT);
    assert.equal(p.blocks[1].color, TEXT);
    assert.ok(Object.values(STATUS_COLOR).includes(p.blocks[2].color ?? ""));
    assert.equal(p.blocks[3].color, TEXT_DIM);
  }
});

test("session lifecycle brackets a session", () => {
  assert.equal(payloadText(build.opened), "release session opened READY 11:04");
  assert.equal(payloadText(build.closed), "release session closed ENDED 11:04");
});

test("bodies read as English", () => {
  assert.equal(payloadText(build.task), "release fix the flaky test RUN 11:04");
  assert.equal(payloadText(build.stepOk), "release running npm test OK 11:04");
  assert.equal(payloadText(build.stepFailed), "release running npm test FAIL 11:04");
  assert.equal(payloadText(build.blocked), "release Allow bash? NEEDS 11:04");
  assert.equal(
    payloadText(build.permission),
    "release Allow Bash: git push --force-with-lease NEEDS 11:04",
  );
  assert.equal(
    payloadText(build.done),
    "release Pinned the clock so the release test is deterministic. DONE 11:04",
  );
  assert.equal(payloadText(build.error), "release provider returned 500 FAIL 11:04");
  assert.equal(payloadText(build.subagentStart), "release delegating to Explore RUN 11:04");
  assert.equal(payloadText(build.subagentStop), "release subagent Explore finished OK 11:04");
});

test("a titleless prompt still reads as English", () => {
  const p = blockedMessage({ panelId: 1, agent: AGENT, wall: WALL, kind: "select" });
  assert.equal(payloadText(p), "release waiting for you to choose NEEDS 11:04");
});

test("done quotes the agent and falls back when it produced no text", () => {
  assert.equal(
    payloadText(doneMessage({ panelId: 1, agent: AGENT, wall: WALL, text: "  " })),
    "release no summary DONE 11:04",
  );
});

test("errors collapse to one line", () => {
  assert.equal(
    payloadText(
      errorMessage({
        panelId: 1,
        agent: AGENT,
        wall: WALL,
        detail: "HTTP 500\n  upstream\ttimed out",
      }),
    ),
    "release HTTP 500 upstream timed out FAIL 11:04",
  );
});

test("prose bodies are shortened to the first usable sentence", () => {
  const long =
    "Refactored the middleware so each request resolves its session once. " +
    "Added a regression test. Also fixed three unrelated typos in the docs.";
  assert.equal(
    payloadText(doneMessage({ panelId: 1, agent: AGENT, wall: WALL, text: long })),
    "release Refactored the middleware so each request resolves its… DONE 11:04",
  );
});

test("a long prompt is shortened but a tool description is summarised", () => {
  const prompt =
    "Refactor the auth middleware so that every request resolves its session once, " +
    "and add a regression test for the double-resolve bug we saw in production.";
  const body = taskMessage({ panelId: 1, agent: AGENT, wall: WALL, task: prompt }).blocks[1].text.trim();
  assert.ok(body.length <= 60);
  assert.ok(body.startsWith("Refactor the auth middleware"));
  assert.ok(body.endsWith("…"));

  const p = stepMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    toolName: "Bash",
    args: { command: 'grep -rn "amber|BG_|ON_DARK" src/*.ts index.ts' },
    cwd: "/repo",
    ok: true,
  });
  assert.equal(payloadText(p), "release running grep OK 11:04");
});
