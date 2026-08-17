---
reusability: high
key_files:
  - /Users/derek/.pi/agent/extensions/sub2api-quota.ts
next_reuse_scenarios:
  - Developing future quota, billing, or model-synchronization extensions for third-party OpenAI-compatible gateways or custom providers.
---

# Reusable Pattern: Custom Gateway Quota & Model Sync Extension for Pi

## Context
When extending the Pi coding agent to interface with custom OpenAI-compatible API gateways (e.g., Sub2API, One API, New API), developers need a robust way to dynamically discover supported models, detect quota capabilities, and display the remaining balance in the status bar without hardcoding provider identifiers.

## Reusable Pattern
1. **Endpoint Capability Detection**:
   Instead of checking the provider's display name, probe `/dashboard/billing/subscription` using the provider's API key. If the endpoint responds with standard billing JSON fields (like `total_amount` or `hard_limit_usd`), classify it as a quota-capable gateway.
2. **Dynamic Model Discovery & Registration**:
   On extension startup, fetch models from `${resolvedBaseUrl}/models` and map them dynamically into the model config array before calling `pi.registerProvider()`. This replaces manual configuration in `models.json` and syncs upstreams automatically.
3. **Multi-Method Quota Updates**:
   Combine OpenAI-compatible billing endpoints (Method 1: subscription/usage API) and gateway-specific keys list endpoints (Method 2: `/api/v1/keys` using User JWT cookie/token) to query the balance, supporting both standard API keys and self-hosted gateway accounts.
4. **TUI Status Bar Balance Displays**:
   Hook into `session_start`, `model_select`, and `turn_end` events to fetch the latest quota balance and update the status bar using `ctx.ui.setStatus()`.

## Reusability Critique (Debate & Evidence)
- **Falsifiability**: This pattern assumes the gateway endpoint responds to standard subscription paths and uses 500,000-to-1 conversion ratio for raw quota units. If a gateway uses a non-standard ratio or locks down billing APIs entirely, the status bar will degrade gracefully to inactive state instead of throwing errors or blocking startup.
- **Evidence Trail Audit**: Verified via unit tests (`test-events.ts` and `test-command.ts`) mocking the global `fetch` and verifying state updates, and by loading the extension in Pi CLI:
  `pi -e ~/.pi/agent/extensions/sub2api-quota.ts --list-models`
- **Entropy Resistance**: Stored as a standalone file because extending the Pi runtime is outside the scope of existing hubs (which cover Immune-Brain-specific workflows, contracts, and core runtimes).
