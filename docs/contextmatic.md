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

All prompts used `language: typescript`, `key: paypal` (resolved with `fetch_api`). Installed SDK: `@paypal/paypal-server-sdk` 2.5.0. ContextMatic's samples say 2.0.0, but every method signature it returned matched the 2.5.0 typings in `node_modules`.

| # | Date | Integration | Tool and prompt | Outcome |
|---|---|---|---|---|
| 1 | Nov 6 | Vault setup token | `ask`: "save a PayPal wallet for future merchant-initiated payments without a purchase … createSetupToken with experience_context return_url/cancel_url and usage_type MERCHANT, get the approve link, then exchange for a payment token" | Kept the call shape: `VaultController.createSetupToken`, `paymentSource.paypal.usageType`, approve link from `links[rel=approve]`. **Corrected:** the sample passed `'MERCHANT'` as a string, but 2.5.0 types require `PaypalPaymentTokenUsageType.Merchant`. → `createVaultSetupToken` in `lib/paypal.ts` |
| 1b | Nov 6 | Vault setup token params | `endpoint_search`: `createSetupToken` | Confirmed the `paypalRequestId` parameter (PayPal stores keys for 3 hours) and the 400/403/422 errors. |
| 2 | Nov 6 | Vault payment token | (same answer as #1) | Kept `createPaymentToken` with `paymentSource.token {id, type: SETUP_TOKEN}`. **Corrected:** the string `'SETUP_TOKEN'` became `VaultTokenRequestType.SetupToken`. Added `paypalRequestId: vault:<setupTokenId>` so a reloaded return page can't create a second token. → `exchangeSetupToken` |
| 3 | Nov 6 | Orders create + capture | `ask`: "create an order with intent CAPTURE that charges a saved vault payment token as a merchant-initiated payment, PayPal-Request-Id for idempotency, then captureOrder … read capture id/status … is the order auto-completed with a vault id?" | Kept `createOrder`/`captureOrder` with `paypalRequestId`, `paymentSource.paypal.vaultId`, and the capture read from `purchaseUnits[0].payments.captures[0]`. **Corrected:** the sample's `storedCredential.paymentType` doesn't exist on PayPal-wallet stored credentials. `model_search PaypalWalletStoredCredential` showed it belongs to `CardStoredCredential`, so it was dropped. **Changed:** `prefer: return=minimal` → `return=representation`, because the capture id is needed from the response. ContextMatic said its sources don't establish whether vault-id orders auto-complete, so the code handles both cases: it uses the capture when the order is already COMPLETED, otherwise it calls `captureOrder` with `<requestId>:capture`. → `chargeVaultedPayment` |
| 4 | Nov 6 | Refunds | `ask`: "fully refund a captured payment with refundCapturedPayment, PayPal-Request-Id, read refund id and status" | Kept as given: no body means a full refund; `paypalRequestId: refund:<purchaseId>`. → `refundCapture` |
| 5 | Nov 6 | Sandbox 403 | `ask`: "createSetupToken returns 403 NOT_AUTHORIZED … token has v1 vault/credit-card scopes but no vault/payment-tokens scope. What app setting is required?" | ContextMatic couldn't answer (not in its SDK docs). Diagnosed by listing the OAuth token's scopes: the app was missing the v3 Vault feature. Fix: enable Vault on the sandbox app in the PayPal Developer Dashboard. |

### What ContextMatic got right, and where it needed checking

- Method names, parameter names and response paths were all correct for SDK 2.5.0. Nothing was guessed from memory.
- `ask` samples sometimes mix fields from sibling models (the card-only `paymentType`) and use string literals where the SDK wants enums. `tsc` caught both, and `model_search` confirmed the right shape.
- It says clearly when its sources don't cover something (auto-capture, sandbox permissions) instead of making it up.
