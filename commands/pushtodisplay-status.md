---
description: Show Push To Display authentication, setup, board, panel, and label status
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs *)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs status`

Relay the status above to the user. If setup is not complete, tell them to run `/pushtodisplay:pushtodisplay-setup`. If setup is complete but auth is not authenticated, tell them to run `/pushtodisplay:pushtodisplay-login`. Do not change any configuration.
