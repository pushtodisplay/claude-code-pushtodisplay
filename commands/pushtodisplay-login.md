---
description: Re-authenticate Claude Code with Push To Display after an expired or revoked login
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs *)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs login`

Relay the output above to the user. If it shows a URL and a code, tell them to open the URL and enter the code in the browser. Do not run the command again or invent a code. On a fresh install, run `/pushtodisplay:pushtodisplay-setup` instead; re-authentication does not clear an existing setup marker.
