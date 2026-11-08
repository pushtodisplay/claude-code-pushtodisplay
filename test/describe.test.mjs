import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DESC,
  cleanCommand,
  describePermission,
  describeTool,
  shortenPath,
  tidyText,
} from "../lib/describe.mjs";

const cwd = "/Users/me/proj";

test("Bash uses the first command line with a present-tense verb", () => {
  assert.equal(describeTool("Bash", { command: "npm test\nnpm run lint" }), "running npm test");
});

test("Bash drops the cd guard, redirections, and | head boilerplate", () => {
  assert.equal(
    describeTool("Bash", { command: "cd /tmp && npm test 2>&1 | head -20" }),
    "running npm test",
  );
  assert.equal(
    describeTool("Bash", { command: "FOO=1 BAR=2 make build > /dev/null" }),
    "running make build",
  );
});

test("Bash summarises a long command to its program and subcommand", () => {
  assert.equal(describeTool("Bash", { command: `echo ${"y".repeat(200)}` }), "running echo");
  assert.equal(
    describeTool("Bash", { command: 'grep -rn "amber|BG_|ON_DARK" src/*.ts index.ts' }),
    "running grep",
  );
  assert.equal(
    describeTool("Bash", { command: "git push -u origin main" }),
    "running git push -u origin main",
  );
});

test("a tool description never exceeds the budget", () => {
  assert.ok(describeTool("Bash", { command: `echo ${"y".repeat(200)}` }).length <= MAX_DESC);
});

test("file tools shorten absolute paths against the cwd", () => {
  assert.equal(describeTool("Read", { file_path: `${cwd}/src/a.ts` }, { cwd }), "reading src/a.ts");
  assert.equal(describeTool("Write", { file_path: `${cwd}/out/b.ts` }, { cwd }), "writing out/b.ts");
  assert.equal(describeTool("Edit", { file_path: "src/index.ts" }), "editing src/index.ts");
});

test("shortenPath rewrites paths under $HOME as ~", () => {
  assert.equal(shortenPath("/home/me/notes.md", { home: "/home/me" }), "~/notes.md");
  assert.equal(shortenPath("/var/log/x", { home: "/home/me" }), "…/x");
});

test("tidyText shortens pasted absolute paths but leaves prose alone", () => {
  assert.equal(
    tidyText("look at /var/folders/abc/pasted-image-2026.png please", { home: "/home/me" }),
    "look at …/pasted-image-2026.png please",
  );
});

test("Edit and MultiEdit append a diff stat", () => {
  assert.equal(
    describeTool("Edit", {
      file_path: "src/a.ts",
      old_string: "a\nb",
      new_string: "a\nb\nc\nd",
    }),
    "editing src/a.ts (+4 −2)",
  );
  assert.equal(
    describeTool("MultiEdit", {
      file_path: "src/a.ts",
      edits: [
        { old_string: "a", new_string: "a\nb" },
        { old_string: "c\nd", new_string: "c" },
      ],
    }),
    "editing src/a.ts (+3 −3)",
  );
});

test("Grep, Glob, WebFetch, WebSearch, Task, and TodoWrite read as English", () => {
  assert.equal(describeTool("Grep", { pattern: "TODO", path: "src" }), "searching for TODO in src");
  assert.equal(describeTool("Glob", { pattern: "**/*.ts" }), "finding **/*.ts");
  assert.equal(
    describeTool("WebFetch", { url: "https://example.com/a" }),
    "fetching example.com/a",
  );
  assert.equal(
    describeTool("WebSearch", { query: "claude code hooks" }),
    "searching the web for claude code hooks",
  );
  assert.equal(
    describeTool("Task", { description: "review auth", subagent_type: "Explore" }),
    "delegating: review auth",
  );
  assert.equal(describeTool("TodoWrite", { todos: [] }), "updating the plan");
});

test("Claude-specific tools have sensible descriptions", () => {
  assert.equal(describeTool("AskUserQuestion", {}), "asking you a question");
  assert.equal(describeTool("ExitPlanMode", {}), "presenting a plan");
  assert.equal(describeTool("Skill", { skill: "review" }), "running skill review");
  assert.equal(describeTool("SlashCommand", { command: "/deploy" }), "running /deploy");
  assert.equal(describeTool("TaskCreate", {}), "creating a task");
  assert.equal(describeTool("Monitor", { command: "tail -f app.log" }), "monitoring tail -f app.log");
});

test("MCP tools keep the server and tool names", () => {
  assert.equal(
    describeTool("mcp__github__create_issue", {}),
    "github: create issue",
  );
});

test("unknown tools fall back to tool(arg: value)", () => {
  const out = describeTool("mcp_create_issue", { owner: "pushtodisplay", repo: "cli" });
  assert.ok(out.includes("mcp_create_issue("));
  assert.ok(out.includes("owner: pushtodisplay"));
  assert.equal(describeTool("mystery", {}), "mystery");
  assert.equal(describeTool("mystery", undefined), "mystery");
});

test("permission prompts state the question", () => {
  assert.equal(
    describePermission("Bash", { command: "git push --force-with-lease" }),
    "Allow Bash: git push --force-with-lease",
  );
  assert.equal(
    describePermission("Edit", { file_path: "/repo/src/auth.ts" }, { cwd: "/repo" }),
    "Allow Edit: src/auth.ts",
  );
  assert.equal(
    describePermission("WebFetch", { url: "https://example.com/a" }),
    "Allow WebFetch: example.com/a",
  );
  assert.equal(describePermission("TodoWrite", {}), "Allow TodoWrite");
});

test("cleanCommand normalises whitespace and handles blank input", () => {
  assert.equal(cleanCommand("  npm   run   build  "), "npm run build");
  assert.equal(cleanCommand("   \n  "), "");
});
