/**
 * Per-Claude-Code setup state.
 *
 * A valid `pushtodisplay` credential is shared by every integration on the
 * machine (Claude Code, Codex, opencode, pi, ...). Credential presence therefore
 * must not be treated as "this integration is set up". This marker is written
 * only after the Claude Code setup flow has verified auth and sent a test
 * entry.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { cacheDir } from "./config.mjs";

export const SETUP_VERSION = 1;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Absolute path of this integration's setup marker.
 */
export function setupPath(env = process.env) {
  return path.join(cacheDir(env), "setup.json");
}

/**
 * True only for a complete marker written by this integration's setup flow.
 * Missing, malformed, and old markers all read as incomplete.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isSetupComplete(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(setupPath(env), "utf8"));
    return Boolean(
      parsed &&
        typeof parsed === "object" &&
        parsed.version === SETUP_VERSION &&
        Number(parsed.completedAt) > 0,
    );
  } catch {
    return false;
  }
}

/**
 * @typedef {object} SetupDetails
 * @property {string} [boardId]
 * @property {number} [panel]
 * @property {string} [label]
 * @property {string} [cliVersion]
 */

/**
 * Record a completed setup for this Claude Code plugin. Atomic write; the
 * marker is deliberately per-user/per-integration cache, not per-session.
 *
 * @param {SetupDetails} [details]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ version: number, completedAt: number, boardId: string, panel: number, label: string, cliVersion: string }}
 */
export function markSetupComplete(details = {}, env = process.env) {
  const dir = cacheDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = setupPath(env);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const record = {
    version: SETUP_VERSION,
    completedAt: Date.now(),
    boardId: details.boardId ?? "",
    panel: details.panel ?? 1,
    label: details.label ?? "",
    cliVersion: details.cliVersion ?? "",
  };
  fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(temp, target);
  return record;
}
