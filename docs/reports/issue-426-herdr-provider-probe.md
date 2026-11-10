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

## 三个 Executor Host 的 OSC 7501 上游实现（2026-11-10 核对）

三个 Host 都已原生发出 OSC 7501，且都先做特性探测再上报；herdr-core 会回应该探测。因此 core 上不需要 Immune-Brain 或第三方提供状态集成。

| Executor Host | 原生支持起始版本 | 上报内容 | 开关 | 证据 |
| --- | --- | --- | --- | --- |
| `claude-code` | 2.1.295 | working、waiting on you、done | 未见环境变量 | `anthropics/claude-code` `CHANGELOG.md` 第 1550 行（`## 2.1.295` 下）：“Added Program Status Protocol (OSC 7501) support: terminals that implement it can show whether Claude Code is working, waiting on you, or done” |
| `pi` | 1.1.0（2026-10-07） | working、blocked（对话框或登录）、done、failed；1.5.1 起 overlay 提问也报 blocked | `PI_PROGRAM_STATUS=1\|0` 覆盖探测 | `earendil-works/pi` `packages/coding-agent/CHANGELOG.md` 第 422 行（`## [1.1.0]`）与第 27 行（`## [1.5.1]`）；issue #10607 以提交 `503c605` 关闭 |
| `antigravity` | Antigravity CLI 1.4.0（10 月 16 日发布） | working、waiting for your input、done、failed | `AGY_CLI_OSC7501=off\|on`；`on` 用于支持但不回应探测的终端 | `google-antigravity/antigravity-cli` release `1.4.0` 说明第一条 |

core 侧：`crates/ghostty-vt/src/tests.rs:155-171` 断言 core 解析 `state=working:app=claude-code:progress=40`、`state=blocked:kind=permission` 等记录，并对探测 `OSC 7501;?` 作出回应。Herdr TUI 0.9.5 不读 OSC 7501，仍用屏幕检测与 socket 集成，与本表无关。

仍未核实，需在运行时确认：

- Claude Code 的 “waiting on you” 在 core 上记录为 `blocked`，且覆盖启动时的 workspace trust、登录与权限对话框；changelog 没有逐一列出对话框种类。Pi 与 Antigravity 的说明同样没有提到 workspace trust。
- 三者在 `hc run` 启动的终端里确实完成探测并开始上报（三者都依赖探测，Antigravity 另有强制开关）。
- 旧版本 Host 不上报：低于上表版本时，core 上的状态始终是 `unknown`。

**准入后果：** herdr-core 上 executor 与 advisory 的准入条件改为“Executor Host 不低于上表版本，并经运行实测确认每类对话框都报 `blocked`”。若某个 Host 漏报某类对话框，Parent 只能等 `hc wait` 的超时（默认 180 秒）醒来，该 Host 在 core 上不准入，直到上游修复。不再需要 Immune-Brain 自建状态集成；若将来某个 Host 撤回原生支持，集成仍应放在 herdr-core adapter，不放进 port 或 Kernel。

## 未完成与下一步

1. **Herdr TUI 运行实测**：在装有 Herdr 0.9.5 的机器上跑 `imm-session probe → create → observe → send → await → read → stop`，三个 Host 各一次，确认上文 TUI 表在运行中的 server 上成立。
2. **herdr-core 运行实测（D2 的 probe）**：装 `hc` 0.1.19，对每个 Host（不低于上表版本）执行 `hc run --bg --json`，用 `hc get` / `hc wait` 记录状态序列：启动、提交 entry、权限提示、workspace trust、完成、退出。逐项确认 `blocked` 覆盖与 `address` 寻址。
3. **herdr-core adapter（S0.5 实现）**：已按用户要求在运行实测之前写成，见 `plugins/immune-brain/runtime/session/herdr_core_provider.ts`，映射见 `docs/reference/supervised-session-port.md`。它通过同一套 conformance suite（stand-in `hc` 取自上述 0.1.19 源码与 schema），可用 `--provider herdr-core` 显式选择，但 Loop 契约尚不使用它。与原计划相比有两处具体化：所有权用随机 token 作为终端标签 `imm-session`，每个动词先读终端核对；创建时先轮询 `hc get` 等 Host 的首个状态上报（30 秒上限），再 `send --if idle`。
4. 1 和 2 通过之前，Loop 契约不启用 herdr-core（D2）；届时再决定由哪项配置显式选择 provider，仍不自动探测。
