---
description: Set up Push To Display after installation — log in if needed, send a test entry, and enable this Claude Code integration
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs *)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs setup`

Relay the result above to the user. If it shows a login URL and code, tell them to open the URL and enter the code in the browser; setup waits for the login, sends one test entry, and only then marks this integration as set up. Do not run the command again while the browser login is pending.
