import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../lib/config.mjs";
import { handleEvent, isIgnoredPrompt, cleanPrompt } from "../lib/events.mjs";
import { payloadText } from "../lib/messages.mjs";
import { createState } from "../lib/panel-state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "fixtures", "events");
const WALL = "11:04:22";

function loadFixtures() {
  return readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const fixture = JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8"));
      return { file: name, ...fixture };
    });
}

const fixtures = loadFixtures();

test("the fixture set covers every hook event the plugin subscribes to", () => {
  const types = new Set(fixtures.map((f) => f.event.hook_event_name));
  for (const type of [
    "SessionStart",
    "UserPromptSubmit",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Stop",
    "StopFailure",
    "SessionEnd",
    "SubagentStart",
    "SubagentStop",
  ]) {
    assert.ok(types.has(type), `missing fixture for ${type}`);
  }
});

for (const fixture of fixtures) {
  test(`fixture: ${fixture.name}`, () => {
    const config = { ...loadConfig({}), ...(fixture.config ?? {}) };
    const state = createState({
      sessionId: fixture.event.session_id,
      agent: fixture.state.agent,
      cwd: fixture.state.cwd,
    });
    const result = handleEvent(fixture.event, state, config, { wall: WALL });

    assert.equal(
      result.actions.length,
      fixture.expected.length,
      `${fixture.file}: action count`,
    );
    for (let i = 0; i < fixture.expected.length; i++) {
      const actual = result.actions[i];
      const expected = fixture.expected[i];
      assert.equal(payloadText(actual.payload), expected.line, `${fixture.file}: line ${i}`);
      assert.equal(actual.urgent, expected.urgent, `${fixture.file}: urgent ${i}`);
      assert.equal(actual.payload.blocks.length, 4);
    }
  });
}

test("UserPromptSubmit keeps the raw prompt for later path shortening", () => {
  const config = loadConfig({});
  const state = createState({ sessionId: "s", agent: "demo", cwd: "/repo" });
  const prompt = `/var/folders/${"x".repeat(80)}/pasted-image.png`;
  handleEvent(
    { hook_event_name: "UserPromptSubmit", session_id: "s", prompt },
    state,
    config,
    { wall: WALL },
  );
  assert.equal(state.task, prompt);
});

test("a new prompt clears the previous assistant text", () => {
  const config = loadConfig({});
  const state = createState({ sessionId: "s", agent: "demo", cwd: "/repo" });
  state.lastAssistantText = "old result";
  handleEvent(
    { hook_event_name: "UserPromptSubmit", session_id: "s", prompt: "next task" },
    state,
    config,
    { wall: WALL },
  );
  assert.equal(state.lastAssistantText, "");
});

test("SessionStart compact does not reset the task", () => {
  const config = loadConfig({});
  const state = createState({ sessionId: "s", agent: "demo", cwd: "/repo" });
  state.task = "still working on this";
  handleEvent(
    { hook_event_name: "SessionStart", session_id: "s", source: "compact" },
    state,
    config,
    { wall: WALL },
  );
  assert.equal(state.task, "still working on this");
});

test("the label falls back to the cwd basename and honors PUSHTODISPLAY_LABEL", () => {
  const state = createState({ sessionId: "s", agent: "old", cwd: "/repo" });
  handleEvent(
    { hook_event_name: "SessionStart", session_id: "s", source: "startup", cwd: "/work/app" },
    state,
    loadConfig({}),
    { wall: WALL },
  );
  assert.equal(state.agent, "app");

  const labelled = createState({ sessionId: "s", agent: "old", cwd: "/repo" });
  handleEvent(
    { hook_event_name: "SessionStart", session_id: "s", source: "startup", cwd: "/work/app" },
    labelled,
    loadConfig({ PUSHTODISPLAY_LABEL: "release" }),
    { wall: WALL },
  );
  assert.equal(labelled.agent, "release");
});

test("prompt cleanup strips pasted-content wrappers and ignores machinery", () => {
  assert.equal(cleanPrompt("look <pasted_content id=\"1\">here</pasted_content>"), "look  here ");
  assert.equal(isIgnoredPrompt("/clear"), true);
  assert.equal(isIgnoredPrompt("/compact"), true);
  assert.equal(isIgnoredPrompt("/pushtodisplay:pushtodisplay-login"), true);
  assert.equal(isIgnoredPrompt("/review the diff"), false);
  assert.equal(isIgnoredPrompt("  "), true);
});
