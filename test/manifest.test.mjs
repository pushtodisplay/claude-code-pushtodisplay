import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PUSHTODISPLAY_CLI_VERSION, resolveCli } from "../lib/cli-adapter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));

const plugin = read(".claude-plugin/plugin.json");
const marketplace = read(".claude-plugin/marketplace.json");
const pkg = read("package.json");
const hooks = read("hooks/hooks.json");

test("plugin manifest has the required identity and metadata", () => {
  assert.equal(plugin.name, "pushtodisplay");
  assert.equal(plugin.version, pkg.version);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20);
  assert.equal(plugin.author.name, "Goban Source LLC");
  assert.equal(plugin.homepage, "https://pushtodisplay.com");
  assert.match(plugin.repository, /^https:\/\/github\.com\/pushtodisplay\//);
  assert.equal(plugin.license, "MIT");
  assert.ok(Array.isArray(plugin.keywords));
  assert.ok(plugin.keywords.includes("claude-code-plugin"));
  assert.equal(plugin.name, plugin.name.toLowerCase());
  assert.match(plugin.name, /^[a-z0-9][a-z0-9.-]*$/);
});

test("marketplace is a single-plugin catalog rooted at this repo", () => {
  assert.equal(marketplace.name, "pushtodisplay");
  assert.equal(marketplace.owner.name, "Goban Source LLC");
  assert.ok(marketplace.description.length > 10);
  assert.equal(marketplace.plugins.length, 1);
  const entry = marketplace.plugins[0];
  assert.equal(entry.name, plugin.name);
  assert.equal(entry.source, "./");
  assert.ok(entry.description.length > 20);
});

test("every hook event uses the exec-form node invocation", () => {
  assert.ok(hooks.description);
  assert.ok(hooks.hooks && typeof hooks.hooks === "object");
  const expected = [
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
  ];
  assert.deepEqual(Object.keys(hooks.hooks).sort(), expected.sort());

  for (const [event, groups] of Object.entries(hooks.hooks)) {
    assert.ok(Array.isArray(groups), `${event} groups`);
    assert.ok(groups.length > 0, `${event} has a handler`);
    for (const group of groups) {
      assert.ok(Array.isArray(group.hooks), `${event} handler list`);
      for (const handler of group.hooks) {
        assert.equal(handler.type, "command", `${event} type`);
        assert.equal(handler.command, "node", `${event} command`);
        assert.deepEqual(handler.args, ["${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs"]);
        if (handler.timeout !== undefined) {
          assert.equal(typeof handler.timeout, "number");
          assert.ok(handler.timeout > 0);
        }
        if (handler.async !== undefined) assert.equal(handler.async, true);
      }
    }
  }
});

test("high-frequency tool hooks are asynchronous; Stop and SessionEnd are synchronous", () => {
  const asyncEvents = ["PostToolUse", "PostToolUseFailure", "SubagentStart", "SubagentStop"];
  for (const event of asyncEvents) {
    assert.equal(hooks.hooks[event][0].hooks[0].async, true, `${event} async`);
  }
  for (const event of ["Stop", "SessionEnd", "PermissionRequest"]) {
    assert.notEqual(hooks.hooks[event][0].hooks[0].async, true, `${event} synchronous`);
  }
});

test("the runtime, commands, and docs referenced by the plugin exist", () => {
  for (const rel of [
    "hooks/hook.mjs",
    "lib/config.mjs",
    "lib/payloads.mjs",
    "lib/messages.mjs",
    "lib/describe.mjs",
    "lib/sender.mjs",
    "lib/auth-gate.mjs",
    "lib/cli-adapter.mjs",
    "lib/events.mjs",
    "lib/state.mjs",
    "lib/device-code.mjs",
    "lib/setup-state.mjs",
    "scripts/command.mjs",
    "scripts/login-worker.mjs",
    "commands/pushtodisplay-setup.md",
    "commands/pushtodisplay-login.md",
    "commands/pushtodisplay-status.md",
    "commands/pushtodisplay-test.md",
    "commands/pushtodisplay-clear.md",
    "vendor/pushtodisplay/package.json",
    "vendor/pushtodisplay/dist/cli.js",
    "README.md",
    "LICENSE",
  ]) {
    assert.ok(existsSync(path.join(root, rel)), `missing ${rel}`);
  }
});

test("every command file uses allowed-tools and dynamic context injection", () => {
  for (const name of ["setup", "login", "status", "test", "clear"]) {
    const file = path.join(root, "commands", `pushtodisplay-${name}.md`);
    const text = readFileSync(file, "utf8");
    assert.match(text, /^---\n/);
    assert.match(text, /allowed-tools: Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/command\.mjs \*\)/);
    assert.match(text, new RegExp("!`node \\$\\{CLAUDE_PLUGIN_ROOT\\}/scripts/command\\.mjs " + name + "`"));
    assert.match(text, /disable-model-invocation: true/);
  }
});

test("the vendored CLI is pinned and resolves without PATH", () => {
  const vendor = read("vendor/pushtodisplay/package.json");
  assert.equal(vendor.name, "pushtodisplay");
  assert.equal(vendor.version, PUSHTODISPLAY_CLI_VERSION);
  assert.equal(vendor.bin.pushtodisplay, "./dist/cli.js");
  assert.ok(existsSync(path.join(root, "vendor/pushtodisplay/dist/cli.js")));

  const command = resolveCli({ env: { PATH: "" }, root });
  assert.equal(command.source, "bundled");
  assert.ok(
    command.prefix[0].includes(path.join("vendor", "pushtodisplay", "dist", "cli.js")),
  );
});

test("the CLI is vendored rather than installed from npm", () => {
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.bundleDependencies, undefined);
});

test("runtime and package scripts use no package launcher", () => {
  const files = [
    "package.json",
    "hooks/hooks.json",
    "hooks/hook.mjs",
    "scripts/command.mjs",
    "scripts/login-worker.mjs",
    "lib/cli-adapter.mjs",
  ];
  for (const rel of files) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(
      text,
      /\b(?:n[p]x|bunx|uvx)\b|\b(?:pnpm|yarn)\s+dlx\b|\b(?:pipx|uv)\s+run\b/,
      rel,
    );
  }
});

test("user-facing docs and commands do not require a separate CLI install", () => {
  const files = [
    "README.md",
    "commands/pushtodisplay-setup.md",
    "commands/pushtodisplay-login.md",
    "commands/pushtodisplay-status.md",
    "commands/pushtodisplay-test.md",
    "commands/pushtodisplay-clear.md",
  ];
  for (const rel of files) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(text, /\bnpx\b|\bnpm\s+(?:i|install)\s+-g\b|\bPUSHTODISPLAY_CLI\b/, rel);
    assert.doesNotMatch(text, /\bpushtodisplay auth login\b/, rel);
  }
});
