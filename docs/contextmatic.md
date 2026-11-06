# Built with ContextMatic: prompt log

This is a log of the PayPal SDK code written with the **APIMatic ContextMatic** plugin active in the coding agent (Claude Code). Each entry records the prompt, what ContextMatic returned, and what was kept.

## Setup (Nov 7, 2026)

ContextMatic is a free Claude Code plugin from APIMatic. It runs a remote MCP server (`https://chatbotapi.apimatic.io/mcp/plugins`) that gives the agent version-aware context for the PayPal Server SDK: real method names, request and response models, and code samples, instead of whatever the model remembers from training.

It was installed with the Claude Code CLI (v2.1.220; v2.1.92 or later is required):

```bash
claude plugin marketplace add apimatic/context-matic
claude plugin install context-matic@apimatic --scope user
```

Then `/reload-plugins` inside Claude Code loads the MCP server. The plugin provides:

| Kind | Name | Use |
|---|---|---|
| MCP tool | `fetch_api` | Find the PayPal Server SDK for TypeScript |
| MCP tool | `ask` | Integration questions, answered with SDK code samples |
| MCP tool | `endpoint_search` | A method's parameters and response shape |
| MCP tool | `model_search` | A model's typed properties |
| Skill | `/integrate-context-matic` | Guided end-to-end integration |
| Skill | `/onboard-context-matic` | Tour of the tools and supported APIs |

## Log

| # | Date | Integration | Prompt | Outcome |
|---|---|---|---|---|
| 1 | | Vault setup token | | |
| 2 | | Vault payment token | | |
| 3 | | Orders create + capture (vault token, PayPal-Request-Id) | | |
| 4 | | Refunds | | |
