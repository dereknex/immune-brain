# Issue #426 Herdr provider probe

日期：2026-11-10。范围：#426 S0 缺口（Herdr TUI adapter 的命令写法与响应形状）和 S0.5 的四项待核实（herdr-core）。决定 D2 要求“先 probe 再采纳”，本文记录 probe 的方法、结论和未完成部分。

## 方法与限制

- 证据来源：上游公开仓库的浅克隆，只读。
  - `herdrdev/herdr` 提交 `ee5bfb5`，`Cargo.toml` 版本 `0.9.5`；读取 `docs/versions/0.9.5/website/src/content/docs/cli-reference.mdx`、同目录 `agent-automation.mdx`、`docs/next/api/herdr-api.schema.json`、`src/protocol/wire.rs`、`src/cli/api.rs`、`src/api/server.rs`。
  - `herdrdev/herdr-core` 提交 `ce81486`，`crates/herdr-core/Cargo.toml` 版本 `0.1.19`；读取 `schema/released.openrpc.json`、`schema/README.md`、`docs/commands.md`、`docs/templates.md`、`README.md`。
- **未运行任何 Herdr 二进制。** 官方 release 的 `herdr-linux-x86_64`（v0.9.5，sha256 `14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d`，发布页无 checksum 文件）已下载，但在本会话的权限策略下执行被拒绝，随后删除。以下结论是“源码与文档核对”，不是运行实测。

## Herdr TUI：结论

协议版本：`src/protocol/wire.rs:20` `PROTOCOL_VERSION: u32 = 22`；`herdr-api.schema.json` 顶层 `"protocol": 22`，与 adapter 锁定的版本一致。

| 项 | 核对结果 | 处理 |
| --- | --- | --- |
| `tab create --workspace --cwd --label --no-focus` | 存在（cli-reference 第 192 行）；ID 位于 `.result.tab.tab_id` 与 `.result.root_pane.pane_id`（第 199 行） | **修正**：adapter 原先读顶层 `tab.tab_id`，真实环境会报 `start_failed` |
| `api schema` | 无参数时打印文本摘要，只有 `--json` 才输出带顶层 `protocol` 的 JSON（`src/cli/api.rs:24-33`） | **修正**：改为 `api schema --json`；原写法会使准入一律 `protocol_mismatch` |
| `agent start <name>` | name 必须匹配 `[a-z][a-z0-9_-]{0,31}`（cli-reference 第 355 行）；启动时 `blocked` 返回 `agent_not_ready`（第 357 行） | **修正**：label 折叠为合法 agent name（如 `S0a` → `s0a`），tab label 不变 |
| 状态字段 | `agent start/prompt/wait/get` 成功时返回 `.result.agent`（agent-automation 第 96 行），状态在 `agent_status`，取值 `idle/working/blocked/done/unknown`（schema `AgentStatus`） | **修正**：只读 `.result.agent.agent_status`，去掉猜测的字段路径 |
| 错误格式 | 服务端错误以 JSON 打到 stderr、退出码 1；语法错误退出码 2（agent-automation 第 98 行）。错误码包括 `timeout`、`pane_not_found`、`agent_not_running`、`agent_not_found`、`agent_blocked`、`agent_prompt_stalled` | **修正**：按 `error.code` 映射，不再用正则匹配文本 |
| `agent wait` | 默认只等 `idle/done/blocked`，`unknown` 不会唤醒（cli-reference 第 359 行）；无默认超时 | **修正**：显式传四个 `--until`，让 `unknown` 也唤醒 Parent；Loop 契约补充“连续两次 `unknown` 告诉用户” |
| `agent prompt --wait` | 已 `blocked` 时返回 `agent_blocked` 且不发送（第 359 行） | 映射为 `state_refused`；adapter 的先查后发检查保留 |
| `pane read --source visible\|recent-unwrapped` | 存在；直接打印终端文本，不是 JSON（第 251 行） | **修正**：输出原样作为文本 |
| `agent send-keys <pane> ctrl+c` | 存在，`ctrl+c` 是合法键名（第 363 行） | 无需改 |
| `pane close`、`tab close` | 存在（第 226、196 行）；`tab close` 可能返回 `confirmation_required` | 已作为 `provider_error` |
| `api snapshot` | 存在（`src/cli/api.rs:13`） | 记录为可接的 `snapshot`，本次不接 |

stand-in `tests/fixtures/fake-herdr/herdr` 已改为输出上述真实形状，`tests/supervised-session-conformance.test.ts` 与 `tests/supervised-session-herdr.test.ts` 在新形状下通过。

## herdr-core：四项待核实的结论

| #426 §3.2 待核实项 | 结论 | 证据 |
| --- | --- | --- |
| `run` 是否返回机器可读 id | 是：`RunResult.address`（如 `t7`），在该 core 上永久有效 | `released.openrpc.json` `RunResult` |
| wait 动词 | `terminal.wait`（`hc wait`）；`reason` 为 `status/exit/output/timeout/not_started`；超时单位是秒，默认 180 秒后“check in”并保持终端运行 | `WaitResult`；`docs/commands.md` `hc wait` |
| send-keys | `terminal.keys`（`hc keys`）与 `terminal.interrupt` | 方法列表 |
| snapshot | 不存在；用 `terminal.list` / `terminal.get` 对账，`events.subscribe` 跟踪变化 | 方法列表 |

另外两条影响准入的事实：

- `terminal.send` 有 `if: idle|working`，是服务端条件发送，没有 TUI 上的先查后发竞态；`force` 会在 `blocked` 时仍然输入（可能代答对话框），adapter 永远不能用（`docs/commands.md` `hc send`）。
- 状态只来自 OSC 7501 自报，core 不看屏幕（`README.md` “Status comes from the program”）；模板不配置自报（`docs/templates.md` 第 4 行）。状态词表是 `idle/working/done/blocked/error`，`error` 不在 port 词表里，映射为 `unknown`。

**谁负责发出 OSC 7501：** 不是 core。`CONTRIBUTING.md:5` 写明“We don't add per-agent integrations or hooks… Agent-specific status support belongs in the program or its integration, not core”，`AGENTS.md:34` 把给 core 加屏幕检测或 agent 识别列为禁止事项，仓库也不附带任何 agent 集成。Herdr TUI 不同：它自己做屏幕检测，并通过 `herdr integration install` 安装的扩展经 socket 上报（Pi 等），不依赖 OSC 7501；Claude Code 与 Antigravity CLI 的状态都来自屏幕检测（`integrations.mdx` 第 113、314 行）。

**准入后果：** executor 与 advisory 角色在 herdr-core 上能否准入，取决于三个 Executor Host（`claude-code`、`pi`、`antigravity`）的状态能否经 OSC 7501 到达 core：由 Host 自身发出，或由某个集成发出。若由 Immune-Brain 提供该集成，它属于 herdr-core adapter（provider 的状态来源翻译），不属于 port 或 Kernel。不能到达的 Host 每个状态都是 `unknown`：不能发指令，也没有 idle/done 唤醒，只剩 `exit`。这一条已写进 `docs/reference/supervised-session-port.md` 的准入矩阵。本次未核实任何一个 Host 是否发出 OSC 7501。

## 未完成与下一步

1. 在装有 Herdr 0.9.5 的机器上跑一次 `imm-session` 全程：`probe → create → observe → send → await → read → stop`，确认上表在运行中的 server 上成立。
2. 决定 OSC 7501 的来源：核实 Claude Code、Pi、Antigravity 是否原生发出；若不发，选择由 Immune-Brain 在 herdr-core adapter 中提供集成、等待上游，或不在 core 上运行 executor。在此之前 S0.5 的 adapter 没有可用的角色。
3. 上面两项通过之前，不写 herdr-core adapter（D2）。
