---
description: Send a test entry to the configured Push To Display board and panel
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs *)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs test`

Relay the result above to the user. If setup is not complete, tell them to run `/pushtodisplay:pushtodisplay-setup`. If it failed, mention `/pushtodisplay:pushtodisplay-status` and the troubleshooting section of the README.
