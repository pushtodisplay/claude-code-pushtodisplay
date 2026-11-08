---
description: Write a `log cleared` entry to this session's Push To Display panel
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs *)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/command.mjs clear`

Relay the result above to the user. This writes a marker entry; it does not delete board history.
