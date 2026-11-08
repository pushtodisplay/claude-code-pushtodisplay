/**
 * Map one Claude Code hook event to zero or more board entries.
 *
 * This is the pure core: no filesystem, no network, no timers. `hooks/hook.mjs`
 * owns persistence and delivery; this module only decides what a person should
 * read on the board.
 *
 *   SessionStart        session opened                         READY
 *   UserPromptSubmit    <prompt>                               RUN
 *   PostToolUse         running npm test                       OK
 *   PostToolUseFailure  running npm test                       FAIL
 *   PermissionRequest   Allow Bash: git push                   NEEDS
 *   Stop                <last assistant message>               DONE
 *   StopFailure         <error type/message>                   FAIL
 *   SessionEnd          session closed                         ENDED
 *   SubagentStart       delegating to Explore                  RUN
 *   SubagentStop        subagent Explore finished              OK
 */
import { clock, labelFor } from "./config.mjs";
import {
  beginSession,
  beginTask,
  cleanAssistantText,
  noteAssistant,
} from "./panel-state.mjs";
import {
  doneMessage,
  errorMessage,
  permissionMessage,
  sessionClosedMessage,
  sessionOpenedMessage,
  stepMessage,
  subagentFinishedMessage,
  subagentStartedMessage,
  taskMessage,
} from "./messages.mjs";

/**
 * @typedef {import("./config.mjs").Config} Config
 * @typedef {import("./panel-state.mjs").PanelState} PanelState
 * @typedef {import("./payloads.mjs").Payload} Payload
 * @typedef {{payload: Payload, urgent: boolean}} HookAction
 */

/** Friendly text for a StopFailure `error` type when no detail is supplied. */
const ERROR_LABELS = {
  rate_limit: "rate limit reached",
  overloaded: "the model is overloaded",
  authentication_failed: "authentication failed",
  oauth_org_not_allowed: "this organization is not allowed to use OAuth",
  account_on_hold: "the account is on hold",
  billing_error: "billing error",
  invalid_request: "invalid request",
  model_not_found: "model not found",
  server_error: "the provider returned a server error",
  max_output_tokens: "the output token limit was reached",
  cloud_credential_error: "cloud credentials could not be loaded",
  unknown: "the model call failed",
};

/** Strip the wrapper Claude Code adds around expanded pasted content. */
function cleanPrompt(text) {
  return String(text ?? "")
    .replace(/<pasted_content[^>]*>/gi, " ")
    .replace(/<\/pasted_content>/gi, " ");
}

/** Commands that are machinery, not work worth mirroring. */
function isIgnoredPrompt(prompt) {
  const text = prompt.trim();
  if (!text) return true;
  if (/^\/pushtodisplay[\w:-]*(\s|$)/i.test(text)) return true;
  if (/^\/(?:clear|compact)(\s|$)/i.test(text)) return true;
  return false;
}

/** Read a string field from an untyped event object. */
function str(event, key) {
  const value = event[key];
  return typeof value === "string" ? value : "";
}

/**
 * Build the entries for one event and update the in-memory session state.
 *
 * @param {Record<string, unknown>} event
 * @param {PanelState} state
 * @param {Config} config
 * @param {{wall?: string}} [opts]
 * @returns {{actions: HookAction[], notice: string}}
 */
export function handleEvent(event, state, config, opts = {}) {
  const wall = opts.wall ?? clock();
  const type = str(event, "hook_event_name");
  /** @type {HookAction[]} */
  const actions = [];
  let notice = "";

  switch (type) {
    case "SessionStart": {
      const source = str(event, "source") || "startup";
      const cwd = str(event, "cwd") || state.cwd || process.cwd();
      state.cwd = cwd;
      state.agent = labelFor({ PUSHTODISPLAY_LABEL: config.label }, cwd);
      // Compaction is not a new session: posting "session opened" again would
      // make every auto-compaction look like a restart.
      if (source === "compact") break;
      beginSession(state, { agent: state.agent, cwd });
      actions.push({
        payload: sessionOpenedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
        }),
        urgent: true,
      });
      break;
    }

    case "UserPromptSubmit": {
      const prompt = cleanPrompt(str(event, "prompt"));
      if (isIgnoredPrompt(prompt)) break;
      beginTask(state, prompt);
      actions.push({
        payload: taskMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          task: state.task,
          cwd: state.cwd,
        }),
        urgent: true,
      });
      break;
    }

    case "PostToolUse": {
      if (!config.steps) break;
      actions.push({
        payload: stepMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          toolName: str(event, "tool_name"),
          args: event.tool_input,
          cwd: state.cwd,
          ok: true,
        }),
        urgent: false,
      });
      break;
    }

    case "PostToolUseFailure": {
      if (!config.steps) break;
      actions.push({
        payload: stepMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          toolName: str(event, "tool_name"),
          args: event.tool_input,
          cwd: state.cwd,
          ok: false,
        }),
        urgent: false,
      });
      break;
    }

    case "PermissionRequest": {
      // Log the blocking prompt, but never return a permission decision:
      // Claude Code's normal prompt must still reach the user.
      actions.push({
        payload: permissionMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          toolName: str(event, "tool_name"),
          args: event.tool_input,
          cwd: state.cwd,
        }),
        urgent: true,
      });
      break;
    }

    case "Stop": {
      noteAssistant(state, str(event, "last_assistant_message"));
      actions.push({
        payload: doneMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          text: state.lastAssistantText,
        }),
        urgent: true,
      });
      break;
    }

    case "StopFailure": {
      const detail =
        str(event, "error_details") ||
        str(event, "last_assistant_message") ||
        ERROR_LABELS[str(event, "error")] ||
        "the model call failed";
      actions.push({
        payload: errorMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          detail,
        }),
        urgent: true,
      });
      break;
    }

    case "SessionEnd": {
      actions.push({
        payload: sessionClosedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
        }),
        urgent: true,
      });
      break;
    }

    case "SubagentStart": {
      if (!config.steps) break;
      const agentType = str(event, "agent_type");
      if (!agentType) break;
      actions.push({
        payload: subagentStartedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          agentType,
        }),
        urgent: false,
      });
      break;
    }

    case "SubagentStop": {
      if (!config.steps) break;
      const agentType = str(event, "agent_type");
      // Claude Code also fires SubagentStop for internal helpers with an empty
      // agent_type; those are machinery, not delegation worth a line.
      if (!agentType) break;
      actions.push({
        payload: subagentFinishedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          agentType,
        }),
        urgent: false,
      });
      break;
    }
  }

  return { actions, notice };
}

/** Exposed for tests: the exact cleanup applied to assistant text. */
export { cleanAssistantText };

/** Exposed for tests: whether a prompt is machinery rather than work. */
export { isIgnoredPrompt, cleanPrompt };
