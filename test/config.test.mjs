import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_PANEL,
  MIN_PANEL,
  cacheDir,
  clock,
  hhmm,
  labelFor,
  loadConfig,
  num,
  truncate,
} from "../lib/config.mjs";

test("loadConfig uses defaults when no env vars are set", () => {
  assert.deepEqual(loadConfig({}), {
    boardId: "",
    panel: 1,
    label: "",
    disabled: false,
    steps: true,
  });
});

test("loadConfig reads board id, panel, label, disabled, and steps", () => {
  const c = loadConfig({
    PUSHTODISPLAY_BOARD_ID: "board-42",
    PUSHTODISPLAY_PANEL: "3",
    PUSHTODISPLAY_LABEL: "cicd",
    PUSHTODISPLAY_DISABLED: "1",
    PUSHTODISPLAY_STEPS: "0",
  });
  assert.equal(c.boardId, "board-42");
  assert.equal(c.panel, 3);
  assert.equal(c.label, "cicd");
  assert.equal(c.disabled, true);
  assert.equal(c.steps, false);
});

test("loadConfig clamps an out-of-range panel to the default", () => {
  assert.equal(loadConfig({ PUSHTODISPLAY_PANEL: "0" }).panel, 1);
  assert.equal(loadConfig({ PUSHTODISPLAY_PANEL: "9" }).panel, 1);
  assert.equal(loadConfig({ PUSHTODISPLAY_PANEL: "garbage" }).panel, 1);
  assert.equal(loadConfig({ PUSHTODISPLAY_PANEL: "2" }).panel, 2);
  assert.equal(loadConfig({ PUSHTODISPLAY_PANEL: "1.5" }).panel, 1);
});

test("num respects the exported panel bounds", () => {
  assert.equal(MIN_PANEL, 1);
  assert.equal(MAX_PANEL, 4);
  assert.equal(num("4", 1), 4);
  assert.equal(num(undefined, 2), 2);
});

test("truncate normalizes whitespace and cuts at a word boundary", () => {
  assert.equal(truncate("  a\n   b  ", 100), "a b");
  const out = truncate("word ".repeat(20), 20);
  assert.ok(out.length <= 20);
  assert.ok(out.endsWith("…"));
  assert.ok(!out.includes("wor…"));
  assert.equal(truncate("x".repeat(200), 20).length, 20);
  assert.equal(truncate("hello", 20), "hello");
});

test("clock and hhmm produce fixed-width times", () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(clock(date), "03:04:05");
  assert.equal(hhmm(clock(date)), "03:04");
});

test("labelFor prefers an explicit label, then the cwd basename", () => {
  assert.equal(labelFor({ PUSHTODISPLAY_LABEL: "release" }, "/repo/app"), "release");
  assert.equal(labelFor({ PUSHTODISPLAY_LABEL: "  " }, "/repo/app"), "app");
  assert.equal(labelFor({}, "/"), "claude");
});

test("cacheDir lives under ~/.cache/pushtodisplay/claude-code", () => {
  assert.equal(
    cacheDir({ HOME: "/home/me" }),
    "/home/me/.cache/pushtodisplay/claude-code",
  );
});
