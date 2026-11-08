---
description: Authenticate Claude Code with Push To Display using the OAuth device-code flow
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs *)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs login`

Relay the output above to the user. If it shows a URL and a code, tell them to open the URL and enter the code in the browser. Do not run the command again or invent a code.
