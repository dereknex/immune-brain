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

1. **Herdr TUI 运行实测**：已执行，见下节；G3 的权限对话框已通过，登录对话框对 Claude Code 失败、对 Pi 不可测。
2. **herdr-core 运行实测（D2 的 probe）**：已执行，见下节；结论是“无 Host 准入”，其中 Claude Code 的 workspace trust 与登录两项都不上报 `blocked`。
3. **herdr-core adapter（S0.5 实现）**：已按用户要求在运行实测之前写成，见 `plugins/immune-brain/runtime/session/herdr_core_provider.ts`，映射见 `docs/reference/supervised-session-port.md`。它通过同一套 conformance suite（stand-in `hc` 取自上述 0.1.19 源码与 schema），可用 `--provider herdr-core` 显式选择，但 Loop 契约尚不使用它。与原计划相比有两处具体化：所有权用随机 token 作为终端标签 `imm-session`，每个动词先读终端核对；创建时先轮询 `hc get` 等 Host 的首个状态上报（30 秒上限），再 `send --if idle`。
4. 1 和 2 通过之前，Loop 契约不启用 herdr-core（D2）；届时再决定由哪项配置显式选择 provider，仍不自动探测。

## 运行实测（2026-11-10）

方法：按 `docs/reports/issue-426-live-test-plan.md` 执行。本机 `herdr` 0.9.5（protocol 22）、`hc` 0.1.19、`claude` 2.1.322、`pi` 1.5.0、`agy` 1.5.3、`bun` 1.4.2；被测代码为 `0fe3f41a` 的 `plugins/immune-brain/bin/imm-session`。herdr-core 全程用隔离的 `HC_SESSION=imm-probe` 与独立 `XDG_STATE_HOME` / `XDG_CONFIG_HOME` / `XDG_RUNTIME_DIR`，默认 session 未停止、未重启。证据：`~/imm-probe/evidence/`（`*.json`、`timeline.log`、`results.md`）。

### 结果

| 用例 | herdr × claude-code | herdr × pi | herdr × antigravity | core × claude-code | core × pi | core × antigravity |
| --- | --- | --- | --- | --- | --- | --- |
| G1 `probe` | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| G2 一轮 `create → observe → await → read → stop` | 通过（先 trust，后 `--resume`） | 通过 | 通过（先 trust，后 `--resume`） | 通过 | 通过 | 通过 |
| G3 workspace trust | 通过：4.03 s 报 `blocked`，entry 未提交 | 不适用（无此对话框） | 通过：4.03 s 报 `blocked` | **失败**：30 s 内无任何上报，`start_failed`；本轮复测仍不上报，改为保留终端 + `attention`，接受后 `--resume` 0.38 s 提交成功 | 不适用 | 未测 |
| G3 权限 | 通过：4.3 s 报 `blocked`，`await` 滞后 0.27 s | 未测 | 未测 | **通过**：2.1 s 报 `blocked`，`status.kind = permission` | 未测 | 未测 |
| G3 登录 | **失败**：登录选择框下报 `idle`，9.4 s 后 `provider_error` / `agent_prompt_stalled`，entry 被误发 | 不可测（`PI_CODING_AGENT_DIR` 只得到空会话） | 未测 | 备选分支：`entry_submitted:false` + `unknown` + `attention`，未报 `blocked` | 未测 | 未测 |
| G4 负向 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |

G2 细节：create 3.7–4.0 s（Herdr，含 agent 就绪）、1.7–3.7 s（core）；一轮 `await` 用 0.05–6.7 s 返回 `changed` 与 `idle` 或 `done`；`read` 均取到 `READY`；`stop` 后 Herdr 关 tab、core 的终端为 `state: "finished"`。

G4 细节：Herdr 外 `probe` / `create` 得 `provider_unavailable` 且 tab 数由 2 到 2；外 workspace 的 handle 得 `not_owned`；core 上假 `claude`（2.1.100）得 `provider_unavailable` 且无新终端；自建终端配猜出的 handle，`observe` 与 `stop` 均 `not_owned`，终端仍 live；`PI_PROGRAM_STATUS=0` 时 30.47 s `start_failed`，entry 未发送。

### 每条“源码核对”结论的状态

| 结论 | 状态 | 实测依据 |
| --- | --- | --- |
| 命令写法与响应形状（`tab create`、`api schema --json`、`agent start`、`agent_status`、`agent wait` 四态、`pane read` 纯文本、`error.code`） | **证实** | A1、A2、A6、A7 均按表返回；顶层 `protocol` 为 22 |
| core 的 `run` 返回永久 `address`、`send --if idle` 由服务端拒绝、`wait` 的 `timeout` 只是 check-in | **证实** | B2、B7、B11：`address` 稳定；`done` 上 `send` 得 `state_refused`；203.8 s 的 `await` 跨过 180 s check-in 后返回 `changed` 与 `done` |
| 三个 Host 原生上报 OSC 7501 | **证实** | core 上首报均为 `idle`：claude ≈0.4 s、pi ≈0.9 s、agy ≈3.5 s |
| `error` 不在 port 词表，映射为 `unknown` | **证实** | claude 撞 5 小时上限时 `status.state` 为 `error`，`await` 返回 `changed` 与 `unknown` |
| 旧版本 Host 不上报 | **证实** | `PI_PROGRAM_STATUS=0` 得 `start_failed`，entry 未发送 |
| “`waiting on you` 覆盖 workspace trust、登录与权限对话框” | **被推翻（workspace trust）** | claude 2.1.322 显示 trust 对话框时，`hc get` 的 `status` 30 s 保持 `null`，create 得 `start_failed` 而非 `blocked` |
| Pi / Antigravity 的说明未提到 workspace trust | Herdr 上**确有该对话框** | 两者在 Herdr 的 create 都返回 `entry_submitted:false` 与 `blocked`，接受后 `--resume` 成功 |
| K1：Herdr 所有权只比 workspace | **已修复并实测** | 本轮：自身 pane 拼出的 handle、尾部改 `000000000000` 的 handle，`observe` / `stop` 均 `not_owned`；core 上自建终端同样 |
| O1：`done` 的指令规则 | **已修复并实测** | 本轮：Herdr 与 core 均在 `done` 上直接 `send` 成功并回到 `working`，无需先聚焦 |
| O2：首报可能是 `done` | **部分推翻** | 三 Host 首报都是 `idle`；真正的风险是“启动对话框 = 完全静默” |
| O4：时延 | 记录 | create 3.7–4.0 s（Herdr）、1.7–3.7 s（core）；G3 的 5 s 门限在 Herdr 的 trust 场景成立 |

### 准入后果（D2）

- **herdr**：三 Host 的 G1、G2、G4 通过；G3 只覆盖 workspace trust，权限与登录未测，按 `supervised-session-port.md` 的准入文本尚不能算全过。
- **herdr-core：无任何 Host 准入。** Claude Code 2.1.322 因 trust 对话框静默而不合格；Pi 1.5.0 与 Antigravity CLI 1.5.3 的权限、登录对话框未测。
- 因此 D2 仍未满足，Loop 契约继续不启用 herdr-core。

### 阶段 C（Loop 端到端，Herdr）

单任务 Lane `probe-c-1` 在 throwaway 仓跑通：原生门打开一次并由用户确认，Parent 经 `imm-session create --provider herdr` 建不抢焦点的 tab，Kernel 结算 `lifecycle: done`、batch `completed`、child `integrated`（commit `b7ab496`，A1 QA passed）；Parent 会话里没有一条直接执行 `herdr tab`、`herdr agent` 或 `herdr pane` 的命令。三个问题：

1. Lane Executor 用 `-e <plugin root>` 启动时，若同一插件也被装成用户级 pi package，工具名冲突使 Host 立刻退出（`start_failed`）；同一机器装两份该插件就起不来。
2. 契约要求“在死 host 的同一 tab 里用 `--resume` 重投 entry”，但 Host 退出后会话是 `unknown`，`resumeRefusal` 只放行 `idle` 与 `done`，必然 `state_refused`，Parent 只能多开一个 tab。
3. 契约要求把 `imm-session await` 作为 Host 后台命令挂起、由返回唤起 Parent；pi 的 bash 工具不会因后台进程结束而唤醒，Parent 只能前台阻塞等待。

### 未覆盖

- A4/B4 权限对话框、A5/B5 登录对话框：claude 处于 5 小时用量上限（不发起工具调用），pi 与 agy 的 shell 工具默认自动放行（agy 真建了文件、无对话框）；且 `imm-session`、`herdr agent start`、`hc run` 都没有注入环境变量的入口，无法用空配置目录触发登录框。
- 阶段 C 只在 pi Executor、单任务 Lane 上跑过；另两个 Host 与并行 batch 未跑。

## 修复（实测之后，2026-11-10）

按“先修 1”处理 K1、O1、C-2，并补上 `--env`。以下改动只有 stand-in 测试覆盖，需在下一轮实测中确认（见 `docs/reports/issue-426-live-test-plan.md` 的 A6、A9、A10、B7、B12 与 A5/B5）。

| 问题 | 修复 | 测试 |
| --- | --- | --- |
| K1 Herdr 所有权只比 workspace | 创建时生成 12 位十六进制 token，写进 tab label（`<label> [imm:<token>]`）并编进 handle（`herdr:<ws>/<tab>/<pane>/<token>`）。每个动词先 `pane get`（pane 在该 workspace、该 tab）再 `tab get`（label 以 token 结尾），不符即 `not_owned`；旧的三段 handle 一律 `not_owned` | `tests/supervised-session-herdr.test.ts` “Herdr adapter ownership (K1)”；去掉 token 检查或 pane-in-tab 检查的变异分别被 2 个、1 个用例抓到 |
| O1 `done` 发不出指令 | port 的 `instructionRefusal` 改为放行 `idle` 与 `done`；batch runner 的 `decideLaneInstruction`（`plugins/immune-brain/runtime/unattended/batch_lanes.ts`）同步放行 `done`；Herdr 直接 `agent prompt`；core 对 `idle` 用 `send --if idle`，对 `done` 用不带 `--if` 的 `send`（`--if` 不接受 `done`，core 仍拒绝 `blocked`，剩下与“刚开始工作”的竞态） | 一致性测试 “delivers one instruction to a done session” ×3 provider；`tests/supervised-session-herdr-core.test.ts` O1 用例；`tests/unattended-batch-lanes.test.ts` 新增 `done` 被接受 |
| C-2 Host 退出后无法原地重启 | Herdr：`--resume` 时若 `agent get` 返回 `agent_not_found` / `agent_not_running` 且 pane 仍在，先在同一 pane `agent start` 再提交 entry（对话框仍报 `blocked`、entry 不提交）；pane 已不在则 `state_refused`。core：已 `finished` 的终端 `--resume` 明确 `state_refused`，由 Parent 新建会话。Loop 契约同步写明 | “Herdr adapter resume (C-2)” 3 个用例；core 的 C-2 用例 |
| 补测入口 `--env` | `imm-session create --env KEY=VALUE`（可重复，只用于 create）：Herdr 走 `tab create --env`，core 在 Host 命令前加 `env K=V`；变量名与单行值在 port 校验 | Herdr 与 core 的 env 用例、CLI 解析用例 |

待实测确认的新写法：`herdr pane get` / `tab get` 的 `.result.pane` / `.result.tab` 形状（取自 0.9.5 API schema 的 `pane_info`、`tab_info`），Host 退出后 `agent get` 的错误码（文档只列出 `agent_not_found`、`agent_not_running` 两种可能），以及 `tab create --env` 对之后 `agent start` 的 Host 是否生效。

### C-3：Pi Parent 不会被后台命令唤醒（修复）

- `imm-session await` 接受多个 handle：任一会话发生转换即返回，并带上该会话的 `handle`；共享的 `timeout` 不带 handle。其余等待通过 `AbortSignal` 取消，`runCommand` 收到取消即对子进程发 `SIGTERM`，CLI 等所有等待结束后才退出，不留孤儿 `herdr agent wait` / `hc wait` 进程。port 的 `awaitTransition` 增加 `signal`，三个 provider 都实现。
- Loop 契约（`dist/drive-batch.md` Herdr Lane Tabs 第 3 步）：后台命令结束能唤起 Parent 的 Host（Claude Code）照旧后台挂起；其他 Host（Pi，及不确定能唤起的 Host）在前台以 `--timeout-ms 600000` 分轮等待，`timeout` 不算转换，Parent 调 `start_unattended_batch`、回应用户后再等，从不改为轮询 `observe`。
- 测试：一致性测试“ends an aborted wait promptly as a timeout”×3 provider；CLI 多 handle 用例（返回正确 handle、无残留进程、共享 timeout、重复 handle 拒绝）；`runCommand` 取消用例。去掉 `child.kill` 的变异被 2 个用例抓到。
- 待实测：Pi Parent 在 Herdr 内按前台分轮等待跑通阶段 C（实测方案 C 阶段第 6 条）。

### C-1：同一插件装两份时 Pi Executor 起不来（修复）

- 成因：Parent 从本地插件目录启动时，按契约把同一目录以 `-e` 传给 Executor；若同一插件也装成了用户级 Pi package，一个 Pi 进程会加载两份 Immune-Brain。Pi 先加载 `-e` 扩展、再加载已安装的扩展（本地依赖 `@earendil-works/pi-coding-agent` 0.84.1 的 `dist/core/resource-loader.js` 中 `mergePaths(cliEnabledExtensions, enabledExtensions)`），两份注册同名工具；且 `imm-canary-work.ts` 每次加载都替换进程级的 Assurance progression，第二份会换掉第一份的状态。0.84.1 只把工具冲突记为诊断；实测的 Pi 1.5.0 直接退出，本地未能复现该版本行为。
- 修复：新增 `plugins/immune-brain/.pi-extension/single-copy.ts`。两个扩展入口先按源目录（realpath 后的插件根）认领自己的 resource loader，以 Pi 让同一 loader 加载的所有扩展共享的 `pi.events` 作标识（0.84.1 `resource-loader.js:158` 的 `this.eventBus`）：第一份的目录拥有该 loader，同一目录重载照常，其他目录的副本什么都不注册，只在 `session_start` 提示一次“已从哪里加载、哪份被忽略”；原拥有目录已不存在（package 被移动或升级）时由新目录接管。因 `-e` 先加载，显式指定的目录生效。`dist/drive-batch.md` 写明该行为。
- 第一版按“进程”认领，`tests/pi-canary-packed-loader.test.ts` 在同进程其他测试之后从打包副本加载时被误判为重复而失败（单独跑通过），因此改为按 loader 认领；该测试现已通过。
- 测试：`tests/pi-extension-single-copy.test.ts`（认领规则与接管；两个真实入口在被他人认领时零注册、只提示一次；自己拥有的 loader 与另一个 loader 都照常注册工具）。
- 实测未通过（2026-11-11）：在装有用户级 Immune-Brain Pi package 的机器上以 `-e <插件目录>` 启动 Executor，pi 仍报 `Failed to load extension … conflicts with …` 并退出（`start_failed`，两次复现）；加 `-ne -ns` 才成功。按 loader 认领的 `single-copy.ts` 覆盖不到“显式 `-e` + 已安装 package”这一组合，因为两份副本由不同的 resource loader 载入。

### Claude Code 启动对话框不上报（缓解，未根治）

- 现象（实测）：Claude Code 2.1.322 在 herdr-core 中显示 workspace trust 对话框时，30 秒内不发出任何 OSC 7501 记录，`hc get` 的 `status` 保持 `null`。原先 adapter 返回 `start_failed`，Parent 只能另起会话，而用户回答对话框后本可继续。
- 缓解：就绪超时不再失败，而是保留终端并返回 `entry_submitted: false`、`state: "unknown"`、`provenance: "none"`，附 `attention` 文本，说明观察到的是“无上报”（可能是启动对话框，也可能根本不上报），并给出 `hc attach <address>`。port 的 `CreateSessionResult` 增加可选 `attention`。Loop 契约把这种结果与 `blocked` 同样处理：转告用户、不发任何按键或文本，用户回答后 `--resume`。adapter 不把沉默猜成 `blocked`。
- 准入不变：G3 要求对话框报 `blocked`，Claude Code 在 herdr-core 上仍不准入；Parent 只有在用户告知后才知道对话框已回答。
- 测试：`tests/supervised-session-herdr-core.test.ts` 中“keeps a silent session for the user…”与“submits the entry once on resume after the user answered…”。
- 根治在上游。以下是可提交给 `anthropics/claude-code` 的 issue 草稿，尚未提交：

> **Program Status Protocol: report `blocked` while the workspace trust dialog is shown**
>
> Claude Code 2.1.295 added OSC 7501 support (CHANGELOG: “terminals that implement it can show whether Claude Code is working, waiting on you, or done”). In 2.1.322, starting `claude` in a directory that has not been trusted shows the workspace trust dialog, but no OSC 7501 record is written until it is answered, under a terminal that answers the `OSC 7501;?` probe (herdr-core 0.1.19). A supervisor therefore cannot tell “waiting on the user” from “still starting”. Expected: a `state=blocked:kind=permission` (or `question`) record while the trust dialog is visible, as for other waiting-on-you states.

## 运行实测（2026-11-11，第二轮）

方法：按 `docs/reports/issue-426-local-validation-plan.md` 执行，被测代码 `claude/affectionate-pascal-prxbzx` @ `abb4d73f91`。本机 `herdr` 0.9.5（protocol 22）、`hc` 0.1.20、`claude` 2.1.322、`pi` 1.5.2、`agy` 1.5.5、`bun` 1.4.2。CLI 级用例由 agent 在 `imm-probe` workspace 的 pane 内驱动；需要回答对话框的用例（trust、权限、登录）由用户本人操作。证据：`~/imm-probe/evidence/v2/`（`results-v2.md`、`*.json`、`C1-parent-session.jsonl`）。

### 端口用例

| 用例 | herdr × claude-code | herdr × pi | herdr × antigravity | core × claude-code | core × pi |
| --- | --- | --- | --- | --- | --- |
| G1 `probe` | 通过 | 通过 | 通过 | 通过 | 通过 |
| G2 一轮 | 通过 6.6 s | 通过 8.7 s | 通过 11.2 s | 通过（见 B3） | 通过 3.0 s |
| G3 workspace trust | 通过：4.09 s 报 `blocked`，接受后 `--resume` 0.53 s 同 tab 提交 | 不适用 | 未测 | 失败：30 s 无上报，`entry_submitted:false` + `unknown` + `attention`；接受后 `--resume` 0.38 s 提交成功 | 不适用 |
| G3 权限 | 通过：4.3 s 报 `blocked`，`await` 滞后 0.27 s | 未测 | 未测 | 通过：2.1 s 报 `blocked`，`status.kind = permission` | 未测 |
| G3 登录 | 失败：登录选择框下报 `idle`，9.4 s 后 `provider_error` / `agent_prompt_stalled`，entry 被误发 | 不可测 | 未测 | 备选分支：`entry_submitted:false` + `unknown` + `attention`，未报 `blocked` | 未测 |
| G4 负向 | 通过 | 通过 | 通过 | 通过 | 通过 |

G2 细节：Herdr tab 名形如 `<label> [imm:<12 位十六进制>]` 且不抢焦点；`await` 返回 `changed` 与 `done`；`read` 均取到 `READY`；`stop` 关 tab，core 终端转 `finished`。

G3 权限细节（A4/B4）：Herdr 走屏幕检测 4.3 s 报 `blocked`；core 走 OSC 7501，2.1 s 报 `blocked` 且 `status.kind` 为 `permission`、`provenance: reported`。Allow 后两者都回到工作态并完成整轮（生成标记文件、回复 DONE）。

G3 登录细节（A5/B5）：`--env CLAUDE_CONFIG_DIR=<空目录>` 生效（Herdr tab 出现 “Select login method”，core 终端出现首次运行引导），但两类 provider 都没报 `blocked`：Herdr 报 `idle` 并把 entry 打进对话框（`agent_prompt_stalled`），core 保持 `status: null` 返回 `unknown` + `attention`。`--env PI_CODING_AGENT_DIR=<空目录>` 只得到全新空会话，不产生登录框，该分支不可测。

### 上一轮修复项的实测确认

| 修复 | 状态 | 依据 |
| --- | --- | --- |
| K1 归属只比 workspace | 证实已修 | 自身 pane 拼出的 handle、尾部改 `000000000000` 的 handle，`observe` / `stop` 均 `not_owned`；core 自建终端同样 |
| O1 `done` 发不出指令 | 证实已修 | Herdr 与 core 均在 `done` 上直接 `send` 成功并回到 `working`，无需先聚焦 |
| C-2 死 Host 不能原地重启 | 证实已修 | 退出后 `await` 0.15 s 返回 `exited` / `unknown`；`--resume` 3.71 s 同 tab 重启完成一轮；core 已 `finished` 的终端保持 `state_refused` |
| `--env` 注入 | 证实可用 | A5/B5/B10 均通过它控制 Host 环境；`PI_PROGRAM_STATUS=0` 时 30.5 s 返回 `entry_submitted:false` + `attention` |
| C-3 多 handle await | 部分证实 | 无 `--timeout-ms` 的 `await` 持续 208.7 s，跨过 180 s check-in 后返回 `changed` / `done`；真实双 Lane 因 F7 未执行 |
| C-1 单插件副本 | 未生效 | 见上一节“实测未通过” |

### 新发现

- **F1 登录 / 选择类对话框在两类 provider 上都不是 `blocked`。** Herdr 还把它当“可发送”，把 entry 打进对话框并失败；core 保持沉默并给出 `attention`。这是 G3 登录一格的失败原因。
- **F2 `close` 的记录只做形式校验。** `closeRecordRefusal`（`runtime/session/supervised_session_port.ts:216-223`）只验 `task_id` 形式与 `recorded_at` 是否为规范 ISO 串，不核对 batch report：`--recorded-at now` 得 `close_unproven`，而 `--recorded-at 2020-01-01T00:00:00.000Z` 直接 `ok:true` 并关掉 tab。
- **F4（环境）mise 的选择框同样静默。** 隔离 `XDG_STATE_HOME` 后 core 终端里的 `claude` 先弹 mise 的 “Trust them?”，30 s 零上报；加 `--env MISE_TRUSTED_CONFIG_PATHS` 后才是真正的权限框。与 F1 同源。
- **F6 `lane_session_close` 无法按契约执行。** 契约（`dist/drive-batch.md:502-512`）要求“report 显示 child `integrated` 时再调用 `start_unattended_batch` 带 `lane_session_close`”，但集成已把 `imm/<slug>` 推离 `base_head`，再进入即 `batch_rejected: batch_parent_branch_exists`；补 `initiative_slug` 得 `batch_entry_kind_mismatch`。唯一可行顺序是把关闭放进集成那一次调用，与契约文字相反。结果：Executor tab 无法由 Parent 关闭。
- **F7 第一个 batch 之后，新 batch 一律起不来。** 后续三次 batch（`par-probe` 并行 ×2、`probe-m1` 单任务 material）都在约 30 s 后把 child 置为 `needs_human`、`lane: null`，原因 `batch_worktree_failed: …/.git/imm/worktrees/<slug>/<task> (refs/heads/imm-lane/<slug>/<task>) has no recorded Lane binding; resource retained`。worktree 与 lane/parent 分支都已创建并指向 base，只是绑定未写进 record；同 slug 不可重试，只能 `git worktree remove --force` + `git branch -D`。代码上 `createLaneWorktree`（`runtime/unattended/batch_lanes.ts:1363-1400`）先建 worktree/branch、后在 admission 之后写绑定，中途失败即留下“有资源无绑定”，下一次 tick 的 `assertLaneWorktreeAvailable`（`runtime/unattended/batch_worktrees.ts:27-37`）只能判死；形态像同一授权周期内并发 tick 的竞态。
- **Parent 行为缺陷（非 port）**：三次 Parent 会话分别出现 ①把“没有活跃 claim”当成缺 TaskIntent，去 `.imm/` 找文件并索要需求；②拿到 `executor` handoff 后主张在 Parent 会话里自己实现，需纠正才改走 `imm-session`；③`lane_session_close` 被拒后考虑 `git reset` 复位 parent branch（未执行）。

### 阶段 C（Loop 端到端，probe-c1）

原生门打开一次并由用户确认，Parent 经 `imm-session create --provider herdr` 建不抢焦点 tab（4.9 s，`entry_submitted:true`），前台 `await` 49 s 返回 `changed` / `done`；Kernel 结算 batch `completed`、child `integrated`、commit `69f4d40`、`qa_failures: 0`、`task-record.lifecycle: done`；`imm/probe-c1` 与 Lane worktree 保留（`git_integration: manual`）。Parent 会话的 16 条 bash 调用里没有一条执行 `herdr tab`、`herdr agent` 或 `herdr pane`（G5）。S1 见 F6，C-3 见 F7，R4（review / verifier / advisory 走会话）因 F7 未能进入。

### 准入后果（D2 更新）

- **herdr**：G1、G2、G4 通过（三 Host）；G3 的 workspace trust 与权限通过，登录对 Claude Code 失败。Claude Code 在 herdr 上仍差“登录对话框”一格；Pi 与 Antigravity 的权限 / 登录未测。
- **herdr-core**：Claude Code 因 workspace trust 与登录两类对话框都不报 `blocked` 继续不准入；Pi 与 Antigravity 的权限 / 登录未测。
- **Loop**：单任务 Lane 在 Herdr 可用，但 Parent 无法按契约关闭 Executor tab（F6）；同仓第二个 batch 无法启动（F7），并行 batch 与 Review 传输都无法实测。
- D2 仍未满足，Loop 契约继续不启用 herdr-core。

### 未覆盖

- A4/B4 的 Deny 分支，Pi 与 Antigravity 的权限与登录对话框。
- C-3 的双 tab 并发与多 handle await；R4 的 S2-a/b/c、S3-a-d、S4-a/b。
- S1-a（未集成时请求关闭）与 S1-c（重复请求 + 伪造 `recorded_at`）的真实 Lane 版本；S1-c 目前只有 CLI 级证据（F2）。

### 待修复清单

| 编号 | 问题 | 证据位置 |
| --- | --- | --- |
| F1 | 登录 / 选择类对话框不报 `blocked`，Herdr 还会误发 entry | 上文 G3 登录细节 |
| F2 | `close` 记录只做形式校验，不核对 batch report | `runtime/session/supervised_session_port.ts:216-223` |
| F6 | `lane_session_close` 的契约顺序不可执行 | `dist/drive-batch.md:502-512`、`batch_lanes.ts` 的 parent-branch 检查 |
| F7 | 新 batch 的 Lane 创建自锁，不可自愈 | `batch_lanes.ts:1363-1400`、`batch_worktrees.ts:27-37` |
| C-1 | 副本去重覆盖不到“显式 `-e` + 已安装 package” | `.pi-extension/single-copy.ts` |
