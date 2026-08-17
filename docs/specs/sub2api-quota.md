# Spec: Sub2API Quota and Model Sync Extension

## Summary
Develop a Pi extension to support capability-based detection of Sub2API (and compatible OpenAI-gateway) providers, automatically synchronize their available models, display their remaining balance in USD on the status bar, and provide a `/quota` slash command.

## Requirements
1. **Capability Detection**: Instead of hardcoding provider names (like "sub2api"), identify quota-capable providers by probing `GET ${baseUrl}/dashboard/billing/subscription` using the provider's API key. If the request returns a standard subscription object, register it as a quota-capable provider.
2. **Model Discovery**: Dynamically query `GET ${baseUrl}/models` to fetch the list of available models for quota-capable providers and register them dynamically using `pi.registerProvider()`.
3. **USD Balance Display**: Fetch total quota and usage to calculate the remaining balance in USD. Display this balance (e.g., `● <provider>: $12.34`) in the TUI status bar when a model from the provider is active.
4. **Interactive Updates**: Automatically update the status bar on model selection (`model_select` event) and turn completion (`turn_end` event).
5. **Slash Command**: Add `/quota` to print detailed billing information (total, used, remaining, expiration, model lists) to the user.

## Design
- **Configuration Loading**: Load credentials from `~/.pi/agent/auth.json` and custom provider base URLs from `~/.pi/agent/models.json` on extension startup.
- **Provider Registry**: Call `pi.registerProvider` for dynamically discovered models.
- **Quota Fetching**:
  - Subscription endpoint: `/v1/dashboard/billing/subscription` or `/dashboard/billing/subscription`.
  - Usage endpoint: `/v1/dashboard/billing/usage` or `/dashboard/billing/usage` with `start_date` and `end_date` query params.
- **Status Bar**: Integrate with `ctx.ui.setStatus`.
