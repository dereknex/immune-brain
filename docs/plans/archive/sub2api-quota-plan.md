# Iteration Plan

## Task

- Summary: Implement a Pi extension to support sub2api (and compatible OpenAI-gateway) providers by auto-detecting billing capabilities, syncing available models dynamically, displaying USD balance in TUI status bar, and registering a `/quota` command.
- Origin: User confirmed capability detection, USD display, and model syncing.
- Spec: `docs/specs/sub2api-quota.md`
- Brainstorm Manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-REQ-004; BR-REQ-005
- Scope Mode: Complete implementation plan for the sub2api-quota extension.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Manifest

| ID | Description |
| --- | --- |
| `BR-REQ-001` | Auto-detect quota-capable providers based on `/dashboard/billing/subscription` API response. |
| `BR-REQ-002` | Automatically sync models from `${baseUrl}/models` and register them dynamically. |
| `BR-REQ-003` | Display balance in USD directly on TUI status bar. |
| `BR-REQ-004` | Refresh balance on `model_select` and `turn_end` events. |
| `BR-REQ-005` | Register `/quota` command to query details. |

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | Provider auto-detection logic handles endpoint probing. |
| BR-REQ-002 | covered_by_step | U1 | Model synchronization is resolved at provider registration. |
| BR-REQ-003 | covered_by_step | U2 | Status bar shows remaining balance in USD. |
| BR-REQ-004 | covered_by_step | U2 | Events model_select and turn_end refresh the status bar. |
| BR-REQ-005 | covered_by_step | U3 | /quota command prints billing details. |

## Research

- Node.js/Bun runtime allows direct file reading of `~/.pi/agent/auth.json` and `~/.pi/agent/models.json` using `node:fs` or `Bun.file`.
- Sub2API (One API/New API) endpoints for billing are `/dashboard/billing/subscription` (returns total_amount) and `/dashboard/billing/usage` (returns total_usage).
- Status bar update is done via `ctx.ui.setStatus(id, text)`.

## Decisions

- D1: Place the extension code under `~/.pi/agent/extensions/sub2api-quota.ts`.
- D2: Load `auth.json` and `models.json` on startup from home directory path.
- D3: Automatically divide quota by 500,000 if values returned are raw quota units instead of USD.
- D4: Query usage with `start_date` spanning 90 days ago and `end_date` as today.

## Assumptions

- User has configured at least one OpenAI-compatible provider with base URL and credentials in `models.json` and `auth.json`.
- TUI environment supports `ctx.ui.setStatus` and theme foreground formatting.

## Devil's Advocate Audit

### 1. Rollback Resilience
- Risk: Extension crashes on startup if files `auth.json` or `models.json` are missing or malformed, blocking the entire Pi agent.
- Mitigation: All file read and fetch operations are wrapped in try-catch blocks with safe fallbacks, ensuring the agent starts up even if detection fails.

### 2. Verification Vanity
- Risk: Quota status bar text displays but fetches fail silently or display outdated numbers.
- Mitigation: Step 2 verification checks console logs and verifies that changes in model select trigger actual network requests.

### 3. Spec Dilution Detection
- Risk: Hardcoding "sub2api" instead of capability detection.
- Mitigation: Step 1 specifically tests dynamic capability check logic against various base URLs.

## Steps

### Step 1
- Step ID: U1
- Result: Provider auto-discovery registers quota-capable endpoints
- Verification type: `automated`
- Verification: Running `pi -e ~/.pi/agent/extensions/sub2api-quota.ts` loads the extension, detects the configured `sub2api` provider from `models.json`/`auth.json` dynamically by probing the endpoint, and registers it.
- Depends on: none

### Step 2
- Step ID: U2
- Result: TUI status bar displays remaining USD balance
- Verification type: `automated`
- Verification: Selecting a model under the detected provider updates the bottom status bar with the remaining balance in USD (e.g., `● sub2api: $12.34`).
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Quota query command displays detailed billing info
- Verification type: `automated`
- Verification: Running `/quota` in the Pi session prints formatted details of total balance, used balance, remaining balance, and expiration date.
- Depends on: 2
