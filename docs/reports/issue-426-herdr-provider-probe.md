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
| C-1 单插件副本 | 第三轮实测通过 | 两份都带 `single-copy.ts` 时 `exit=0`；只有旧 checkout 时仍冲突（旧副本无认领代码） |

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

| 编号 | 问题 | 状态（第三轮实测后） | 证据位置 |
| --- | --- | --- | --- |
| F1 | 登录 / 选择类对话框不报 `blocked`，Herdr 还会误发 entry | 已修（见“修复（第二轮实测之后）”）；第三轮 A5 通过：`unknown` + `attention`、entry 未发出 | 上文 G3 登录细节 |
| F2 | `close` 记录只做形式校验，不核对 batch report | 已修：`close` 必须带 `--batch`，由 `closeRecordUnproven` 核对记录；第三轮 S1-c 三次伪造均被拒 | `runtime/session/cli.ts:106-120` |
| F6 | `lane_session_close` 的契约顺序不可执行 | 已修（改为集成 tick 记录 `session_closes`）；第三轮 S1 按新契约关闭成功 | `batch_lanes.ts:248-261` |
| F7 | 新 batch 的 Lane 创建自锁，不可自愈 | 已修；第三轮同仓第 2、3 个 batch 均正常创建 | `batch_lanes.ts:1363-1400` |
| C-1 | 副本去重覆盖不到“显式 `-e` + 已安装 package” | 已修（按进程认领）；第三轮两份修复版副本共存 `exit=0`，旧副本仍冲突 | `.pi-extension/single-copy.ts` |
| F8 | 配置解析顺序：active 用户 profile 覆盖项目 `lanes.*`（预期 project 优先），且 profile 设 `review_host` 时项目的 `review_verifier_model` 被丢弃 | 非缺陷：键写错了层（ADR 0037），见“修复（第三轮实测之后）” | `runtime/config/layered_config.ts:178-182` |
| F9 | Herdr 外的非交互 Executor 完成后被判 `lane_executor_no_progress`，Lane 无 `task-record.json` | 已修：起进程前拒绝 `pi`，返回 `lane_executor_requires_tui`；未实测 | 上文 S4-b 行与 F9 条目 |
| F10 | claude-code reviewer 的评审结论被判 coverage 不足（两轮后 park），无 findings/verify | 已修：git allow-list 加 `--no-pager` 形式；真实模型复跑未做（BR-SCN-1） | `runtime/assurance/coordinator.ts:1551,1741`；上文 S3 行与 F10 条目 |

## 修复（第二轮实测之后，2026-11-11）

按 F7 → F6、F2 → C-1 → F1 与 Parent 约束的顺序修复；每项都先写出在旧代码上失败的测试。

### F7：Lane 创建自锁（修复，`51c9e77d`）

- 成因：parent-branch batch 的 tick 先建 worktree 与 `imm-lane/<slug>/<task>`，到 admission 才写绑定。中间任何一处停下都会留下“有资源无绑定”：admission 时 `canStartTask` 的二次检查、`decideLaneAdmission` 拒绝、子任务预算 `break`，或 tick 被中断。下一次 tick 的 `assertLaneWorktreeAvailable` 只能把它当冲突，并 park 子任务。实测没有留下第一次 tick 的证据，具体是哪一处无法确认，但这些路径都会导致同一结果。
- 修复：创建前先把 `lane_reservation`（path、branch、base_head）写进 batch record（`batch_state.ts` 新增可选字段，只允许出现在 `pending`、`needs_human`、`skipped_blocked` 且没有 `lane` 的子任务上）。下一次 tick 由 `ensureReservedLaneWorktree`（`batch_worktrees.ts`）补建或接管，前提是资源仍与预留一致：分支在预留的 base 上，且就检出在预留的 worktree 里。分支被移动、被另一个分支检出、路径里有用户文件、分支是 symbolic ref、目录含 symlink，都拒绝并原样保留。绑定时清除预留。没有预留的孤儿仍然拒绝。
- 测试：`tests/single-task-lane-batch.test.ts`“adopts a Lane created by a tick that stopped before binding it”（第一次 tick 的 admission 二次检查拒绝，第二次 tick 接管同一路径；旧代码上失败）；`tests/batch-parent-branch.test.ts` 覆盖在预留、目录、分支、worktree 四个点中断后的续建，以及五种不一致时拒绝且不改动资源。

### F6、F2：关闭流程（修复，`51afbb0a`）

- F6：在集成子任务的那一次 tick 里，runner 自己把可关闭的 session 记进 `session_closes`（子任务已 `integrated`，审计对可从 batch head 到达）。这次 tick 即使结束了 batch，记录也已在 report 里，Parent 不必再进入已完成的 batch。`lane_session_close` 对已记录的子任务返回同一条记录，不再以“already recorded”拒绝。
- F2：`imm-session close` 必须带 `--batch <batch_id>`，从协调 checkout（或 `--root`）读取 `.imm/state/batches/<batch_id>.json`，只有记录里列出了同一 `task_id` 和 `at` 才关闭。`runtime/session` 只读文件，仍不 import batch runtime。
- 测试：`tests/unattended-batch-lanes.test.ts`（集成 tick 的 report 已带 `session_closes`，再次请求返回同一记录）；`tests/supervised-session-herdr.test.ts`（无记录文件、记录里没有这条关闭、`at` 不同，都是 `close_unproven`，且不调用 `tab close`）。

### C-1：按进程认领（修复）

- 更正成因：上一版的认领表是 `single-copy.ts` 模块级的 `WeakMap`。两份插件副本是两个模块实例，各有一张表，互相看不见；所以无论按 loader 还是按其他作用域认领都会失效。实测里两份副本又由不同 loader 载入，结果还是一样。
- 修复：认领放到 `globalThis[Symbol.for("immune-brain.pi-extension.copy-owner")]`，每份副本拼写相同的键，所以按进程共享。规则不变：第一份目录拥有，同目录重载照常，其他活目录的副本不注册并提示一次，原目录消失时接管。`tests/pi-canary-packed-loader.test.ts` 在载入打包副本前清掉同进程里源码副本的认领，结束后再恢复。
- 测试：`tests/pi-extension-single-copy.test.ts` 新增“临时目录里的另一份 `single-copy.ts` 模块实例看见同一认领”，以及另一个 loader 也零注册。

### F1 缓解与 Parent 约束（缓解）

- F1：`create` 提交 entry 时，Herdr 返回 `agent_prompt_stalled` 现在映射为 `entry_submitted: false`、`unknown`、`attention`，tab 保留。`attention` 说明 entry 可能已打进对话框，用户看过之前不要重发。`send` 仍是 `provider_error`。登录框仍不报 `blocked`，所以 Claude Code 的 executor 角色在 `herdr` 上继续不准入。
- Parent 约束（`dist/drive-batch.md`）：
  - Parent 只协调，不在自己的会话或 checkout 里实现、编辑或测试子任务。
  - 被拒绝时按 recovery action 处理或告诉用户，不 reset、rebase 或移动任何 branch，不删除或 prune worktree、branch。
  - “没有活跃 claim”是 Kernel 事实，不是缺 TaskIntent。
  - `herdr` 上的 `attention` 在用户回答后，先问用户 entry 是否已被 Host 接收，再决定是否重发。

### herdr-core 的观看 tab（新增）

core 不画任何界面，而 `hc attach` 会把执行它的终端接到 session 上；若由 `imm-session` 直接执行，被接管的就是 Parent 自己的终端。现在在 Herdr 内创建 core session 时，Herdr adapter 会在 Parent 的 workspace 里开一个不抢焦点的 tab，运行 `hc attach <address> && exit`。这一步在第一次轮询状态之前完成，所以启动对话框会直接显示在这个 tab 里。tab 会带上 `HC_SESSION` 与 `XDG_*`，保证连到同一个 core。结果里带 `viewer: { opened }`；tab 开不出来不影响 session 本身。`imm-session attach <handle> --provider herdr-core` 可以再开一个。在 Herdr 外不开任何 tab，提示改为在另一个终端执行 `hc attach`。测试：`tests/supervised-session-herdr-core.test.ts`“herdr-core viewer tab inside Herdr”，以及 `tests/supervised-session-herdr.test.ts` 的 viewer 拼写。未经实测：`hc attach` 在 Herdr pane 里的显示与退出行为。

### 仍需实测

R3（并行 batch 与 S1 关闭）、R4（S2、S3、S4 走会话）、C-1（显式 `-e` 加已安装 package），以及 F1 的 `attention` 在 Herdr 登录框下的真实表现。

## 运行实测（2026-11-11，第三轮）

被测代码 `97152e2291`（含 `51c9e77d63` F7、`51afbb0a4d` F6/F2、`3537ed12c1` F2 契约、`9c03705f4c` C-1 等修复）。运行时 herdr 0.9.5、claude 2.1.322、pi 1.5.2；Parent 用 Pi（`grok/grok-4.7@500k`，antigravity 模型当日配额耗尽）。按 `docs/reports/issue-426-local-validation-plan.md` §0.1 的八步执行，每个场景用全新仓库（`~/imm-probe/L3/single`、`L3/par`、`L3/rev`）以隔离 F7。证据：`~/imm-probe/evidence/v3/`。

| 步骤 | 用例 | 结果 | 关键数据 |
| --- | --- | --- | --- |
| 2 | A5 登录框（F1） | **通过** | `ok:true`、`entry_submitted:false`、`state:"unknown"`、`provenance:"none"`，`attention` 含 “do not send the entry again”；登录框仍在、**entry 未被发送**、tab 保留 |
| 3 | 单任务 Lane（probe-r3） | 通过 | Executor tab 不抢焦点；`await` → `done`；integrated `08f5c5a`；report 自带 `session_closes: [{probe-r3, at: 13:32:39.161Z}]` |
| 3 | S1-a（未集成时请求关闭） | 通过 | `accepted:false`，`batch_lane_session_close_refused: … is enrolled, not integrated; its session stays for the user` |
| 3 | S1（按新契约） | 通过 | `close <handle> --batch <batch_id> --task … --recorded-at <session_closes[].at> --root …` → `{"ok":true}`，tab 关闭 |
| 3 | S1-c（三次伪造） | 通过 | 缺 `--batch` → 用法错误；`--recorded-at 2020-01-01T00:00:00.000Z` 与错 `--task` → 均 `close_unproven`，tab 未关 |
| 4 | F7 连续新 batch | **通过（修复生效）** | 同仓第 2、3 个 batch 均 `enrolled` 且 `lane` 绑定成功，无 `batch_worktree_failed`；`probe-f7a` 结算 `completed`/`28e6744`/`session_closes`/tab 关闭；`probe-f7b` integrated `40b407b` 后停在 `needs_human`，原因是 **`checkout_delivery_overlap: README.md`**（前两批投递到 checkout 的改动未提交，第三次投递同文件重叠） |
| 5 | C-3 并行 batch | **通过** | 两个 Executor tab 同时出现（`slice-a`、`slice-b`）且都不抢焦点；Parent 一次 `await` 带两个 handle；两者 integrated（`a6f0f77`、`835ceb6`）；`session_closes` 两项；两个 tab 均关闭 |
| 6 | C-1 | **通过（两份都为修复版）** | 本分支副本装到用户级后，`pi -e <插件根> -p` `exit=0`，无工具冲突；用户级是旧 checkout（无 `single-copy.ts`）时仍 `Failed to load extension … conflicts with …`（`exit=1`）——旧副本缺认领代码，属升级问题。测试后已恢复用户级安装 |
| 7 | S4-a review 走会话 | **部分通过** | 出现 tab `review probe-m1 [imm:f435aaca1723]`，内部执行 `imm-cli-review-…/review.sh` 并以 `IMM_f435aaca1723_DONE_0` 退出；批次 `completed`、integrated `0729940`、`lifecycle: done`、`findings: 0`、attestation 为 `cli:pi:…` |
| 7 | S2-a advisory 走会话 | 通过 | `create` → `await` → `read --source scrollback --lines 2000 --extract advisory`：`result` 非 null（1183 字符），Parent 采用后 `stop` |
| 7 | S2-b 打断 | 通过 | 在 child 生成过程中按 `Ctrl+C`：`read --extract advisory` 返回 `result: null`，Parent 按 `result_untrusted` 丢弃且不重试 |
| 7 | S2-c 原始输出 | 记录 | `S2c-raw.json` 保存了 `--source scrollback --lines 2000` 的原文；未打断的那次原文含完整 `IMM-ADVISORY-BEGIN/END` 块 |
| 7 | S3-a–d | **未触发（第三次尝试暴露 F10）** | 前两次 reviewer 为 pi、均 0 finding；第三次按计划换成 claude-code/opus（临时用户 profile），两轮 review 都以 `IMM_…_DONE_0` 退出却被判 `Review coverage remained incomplete after two rounds`，batch 停在 `needs_human`，未产生 findings / verification_ready / verify tab |
| 7 | S4-b（Herdr 外） | **未验证（新现象 F9）** | 用 `env -u HERDR_ENV …` 起 Pi Parent（已核对进程 env 无 `HERDR_ENV`），门通过后 child `enrolled`，随后停在 `needs_human` / `lane_executor_no_progress`；Lane 里 `src/parse.js`、`tests/parse.test.js` 已暂存（Executor 实际完成实现），Lane 无 `task-record.json`。未走到 review 准备，`review_transport_unavailable` 未实测；复现得到 `code=tui_required`（见 F9） |
| 8 | B2 | 通过 | create 2.08 s → `entry_submitted:true`、`reported`、`viewer:{opened:true}`；不抢焦点的 `probe-r5 (hc t1f)`；`await` → `done`；read 含 READY |
| 8 | B3（claude trust） | 通过（G3 仍记失败） | `entry_submitted:false`、`unknown`、`none`、`viewer:{opened:true}`，`attention` 含 “look in its viewer tab, answer it there, then resume”；在观看 tab 接受 trust 后 `observe` → `idle`，`--resume` 0.33 s → `done`；`stop` 后观看 tab 消失、终端 `finished` |
| 8 | B13 观看 tab 去留 | 通过（只记现象） | 关掉观看 tab 后 `attach` → `{"ok":true}` 并新建不抢焦点 tab；在观看 tab 按 `ctrl+\` 分离后 tab **自动关闭**；再 attach、`stop` 后观看 tab 结束 |
| 8 | B14 归属与跨 provider | 通过 | `herdr-core:<addr>/guessed` → `not_owned`，不开 tab；Herdr handle 用 core provider `attach` → `provider_unavailable`（“herdr has no separate viewer”） |
| 8 | S1-d | 通过 | 无 record 时 `close_unproven`、终端仍 `live`；写入手写 record 后同一命令 `{"ok":true}`，终端 kill+rm、观看 tab 消失 |

| A4 Deny | 通过 | `--permission-mode manual` → `blocked`；点 No 后回到 `idle`，`touch` 未执行 |

| 8 | B5（新代码复测） | 通过（备选分支） | 30.2 s → `entry_submitted:false`、`unknown`、`viewer:{opened:true}`、`attention`；屏幕为 Claude 首次运行引导 |
| 8 | B3（Pi 分支） | 不适用 | pi 在 core 的未信任目录里无 trust 框，直接 `entry_submitted:true` → `done` |
| 8 | B8（新代码复测） | 通过 | 假 `claude 2.1.100` → `provider_unavailable`，无新终端 |
| 3 | S1-e | 通过 | 并行 batch 中一条已集成、另一条仍在跑时请求 `lane_session_close`：`accepted:true`，`recorded_at` 与已记录的 `session_closes[0].at` 完全一致，不新增记录 |
| 3 | antigravity Executor | 通过 | 显式 `executor_host="antigravity"`：先出 agy trust 框，接受后 `--resume` 提交 `/drive probe-ag`，结算 `completed`/`a8b0b02`，tab 由 Parent 关闭 |
| 3 | Claude Code 作 Parent | 通过 | `claude --plugin-dir` 跑 `/immune-brain:drive probe-cc`：await 以后台命令挂起，返回后重入并关闭 tab；`completed`/`ea2574f`/`session_closes` 齐备。备注：`auto mode` 下原生门被自动通过，非人工确认 |

### 第三轮发现

- **F8 配置解析顺序错位（新）**：`layered_config.ts:178-182` 让 active 用户 profile 覆盖项目 `.imm/config.json` 的 `lanes.*`；当 profile 设了 `review_host` 时，项目的 `review_verifier_model` 等依赖键会以 `not_applied` 警告被丢弃。预期应为 **project 优先**。后果：计划 §7 的 `review_host: claude-code` / `review_model: opus` / `review_verifier_model: sonnet` 在本机不生效，review 实际由 `cli:pi:…`（`group/kimi-k3.1`）执行，S3 的 `verifier_model` 与 `model_relation: "different"` 无法验证。
- **投递约束（非缺陷）**：`git_integration: manual` 下连续 batch 投递同一路径到未提交的 coordinator checkout 会 `checkout_delivery_overlap` 停在 `needs_human`；需在每个 batch 后提交投递改动，或让不同 batch 使用不同路径。
- **F10（新）claude-code reviewer 的结论不被 coverage 判定接受**：reviewer 为 pi 时同一强度任务 `findings: 0` 并正常集成（probe-m1、probe-m3）；换成 claude-code/opus 后两次 review 虽 exit 0（各约 11 s），却被 `review_incomplete`（`coordinator.ts:1551/1741`，`incomplete.count >= round_limit`）判为覆盖不足并 park。reviewer 启动参数自检正常（`--tools Read,Grep,Glob,Bash --permission-mode dontAsk --model opus` 可直接返回），需复现并检查 `imm-cli-review-*/review-output-*.txt`。
- **F9（新）Herdr 外的非交互 Executor 永远结算不了**：`executorArguments`（`runtime/unattended/lane_supervisor.ts:22-36`）在无 Herdr 时用 `pi --print "/skill:drive <task>"` 启动 Executor，而 Kernel 写入只允许 TUI 会话——在 Lane 里手动重放同一命令，`imm_kernel_canary advance_assurance` 返回 `state=blocked`、`code=tui_required`、"Kernel mutation is TUI-only"，且未产生任何副作用。于是 Executor 实现了代码（`src/parse.js`、`tests/parse.test.js` 已暂存）却无法 settle，批记录停在 `needs_human` / `lane_executor_no_progress`，Lane 侧没有 `task-record.json`。影响：任何 Herdr 外的 Lane 批都走不完 assurance/review，S4-b 的 `review_transport_unavailable` 因此未实测。
- **Parent 侧仍需人工纠偏**：本轮 Parent 出现过“把无活跃 claim 当成缺 TaskIntent”“拿到 handoff 后主张自己实现”，与第二轮的 Parent 行为问题同类，未计入产品缺陷。

### 第三轮后的结论

- 第二轮提出的 F1、F2、F6、F7 与 C-1 **均已被实现修复并实测通过**；F6 实际是设计已改为“集成 tick 记录 `session_closes`，Parent 读取后关闭”，第二轮把它当成缺陷是误判，因为当时走的是已被删除的请求入口。
- 第三轮之后：F8 判为非缺陷，F9、F10 已修（见“修复（第三轮实测之后）”）。仍未解决：S3 的真实 rework 路径、S4-a 的 Parent 侧 `review_ready`、C-3 的 Claude Code 并行变体。

## 修复（第三轮实测之后，2026-11-12）

针对第三轮的三项新发现（见上文“第三轮发现”）。F8 不是缺陷，F9、F10 已在本分支修复（TaskIntent `issue-426-review-git-and-pi-tui`，Lane 提交 `548d5ac2af`）。

| 编号 | 现象 | 判定 | 证据与修复 |
| --- | --- | --- | --- |
| F8 | 把 review 键写进 `.imm/config.json`，生效的 Host 仍是 user lane profile 里那个 | 非缺陷：测试配置错误 | review 键按现有 active-profile → project 优先级解析（ADR 0037 “Review profile”；`runtime/config/layered_config.ts:178-182`），活跃 user lane profile 设了 `review_host` 时项目值不生效。第三轮把键写错了层。解析器不改；验证时改走 user lane profile（validation plan §7）。 |
| F9 | Herdr 外由 runtime 起 `pi --print` 跑 Executor，永远等不到 Kernel 写入（`code=tui_required`） | 缺陷（已修复） | 成因：`lane_supervisor.ts` 的 `executorArguments` 对每个 Host 都拼非交互入口，而 Pi 只在 TUI 里写 Kernel（ADR 0027）。修复：`superviseLane` 在为新 generation 起进程前拒绝 `pi`，返回 `state: unavailable`、`reason: lane_executor_requires_tui`；batch 报告把子任务留在 `enrolled`、保留带 Lane 路径与 `task_id` 的 `executor` handoff，`next_action` 让用户在 Lane 里跑交互式 pi 的 `/skill:drive <task_id>` 后再调一次 `start_unattended_batch`。不回退到别的 Executor Host。 |
| F10 | claude-code reviewer/verifier 在 `dontAsk` 下拿不到 git，Review 以 `inspected_paths: []` 结束 | 缺陷（已修复） | 成因：`--allowedTools` 只放行六条 `Bash(git <sub>:*)`，模型常发的 `git --no-pager …`（以及 `git -C …`、管道、重定向）被拒。修复：reviewer 与 verifier 共用一份十二条 allow-list——六条原样加六条 `--no-pager` 形式；`authority-review` 与两个 role prompt 要求一次一条 git 命令、在当前目录、不用 `-C`、管道和重定向，`--no-pager` 只放在第一个参数。`git -C` 与 `--no-pager` 之外的新形式仍不准入。 |
| F11 | 修了 F10 之后，在装有用户级 PreToolUse hook 的机器上，claude-code reviewer/verifier 仍然所有 git 都被拒 | 缺陷（已修复） | 2026-11-12 用 `2118d025be` 的 reviewer 参数直接跑 `claude --print --permission-mode dontAsk`：默认用户设置下 `git --no-pager show`、`git diff` 全部被拒，`permission_denials` 里的命令带 `rtk` 前缀——用户的 `rtk hook claude` 把 `git …` 改写成 `rtk git …`，十二条 `Bash(git …:*)` 都匹配不上；加 `--setting-sources project,local` 或 `--settings '{"disableAllHooks":true}'` 后同样的命令通过，`git -C` 仍被拒。修复：reviewer 与 verifier 的 claude-code argv 都带 `--settings '{"disableAllHooks":true}'`（`REVIEW_HOST_SETTINGS`，`runtime/assurance/cli_review.ts`）。receipt 来自 output 文件而非 hook，关 hook 不丢任何证据；同条件下 `immune-brain:authority-review` 仍出现在 init 的 slash_commands 里。Pi 与 antigravity 的 argv 不变。 |
| F12 | claude-code verifier 读不到自己的 verification packet | 缺陷（已修复） | 2026-11-12 v4 在 `~/imm-probe/L4` 用 PR 头 `ac6be56af5` 的 `verificationArguments` 跑真实 `claude`，packet 按生产写到 `tmpdir()/imm-cli-verify-*`：`permission_denials` 为 `Read …/verify-packet.md`，verifier 以散文作答，没有 JSON；同一运行加 `--add-dir <packet 目录>` 后 `git --no-pager show`、`git diff` 通过、`git -C` 被拒，返回预期 JSON（证据 `~/imm-probe/evidence/v4/smoke-args/`）。reviewer 早已带 `--add-dir`，verifier 漏了。修复：claude-code verifier argv 带 `--add-dir dirname(packet)`，verify 目录与 review 目录一样取 `realpath`（`runtime/assurance/cli_review.ts`）。Pi 与 antigravity 的 argv 不变。 |
| F13 | claude-code reviewer 加载用户安装的旧版 `authority-review` skill | 缺陷（已修复，契约随之修订） | 2026-11-12 v4 `probe-m2`：Parent 以 `--plugin-dir` 跑 PR 头，reviewer argv 不带 `--plugin-dir`，加载用户级 immune-brain 8.1.2（skill 契约哈希 `sha256:2e4d13dd…`），而 Kernel 期望 `sha256:6012cd08…`；两次 Review 都以 `review_contract_mismatch` 释放（证据 `~/imm-probe/evidence/v4/m2-notes.md`）。原 spec 明确不带 `--plugin-dir`（`docs/specs/review-cli-stage.spec.md` D5），按用户决定修订。实测 `claude --plugin-dir` 会盖过同名已安装插件（init 只列出 inline 8.1.3）。修复：claude-code reviewer argv 带 `--plugin-dir <runtime 所在 Claude 插件根>`（`runtimeClaudePluginDir` 在 `runtime/plugin_source_skew.ts`，调用点 `runtime/assurance/cli_review.ts`）；无 Claude 清单时（antigravity 镜像）不带。 |

F9 只在 Pi 上验证；`claude --print` 与 antigravity 在 Herdr 外的监督行为本轮未复测（BR-DEFER-2）。F10 的十二条 allow-list 与 F11 的关 hook 参数由自动化测试覆盖，并用真实 `claude` 做过一次 argv 级冒烟（上表 F11）；完整的 Review 复跑仍然延后（BR-SCN-1）。

## 整体验证报告（#426 收尾）

综合三轮实跑（2026-11-10 首轮、2026-11-11 第二/三轮）。被测代码从 `0fe3f41a` → `abb4d73f91` → `97152e2291` 演进；有效结论以 `97152e2291` 为准。运行时 herdr 0.9.5（protocol 22）、hc 0.1.20、claude 2.1.322、pi 1.5.2、agy 1.5.5。证据在 `~/imm-probe/evidence/{v2,v3}/`。

### 1. 覆盖矩阵

| 组 | 用例 | 状态 |
| --- | --- | --- |
| 端口 · Herdr | A1、A2（×3 Host）、A6、A7、A8、A9、A10、S4-c | 通过 |
| 端口 · Herdr · 对话框 | A3（claude/agy trust）、A4（claude 权限，Allow 与 Deny 两分支） | 通过 |
| 端口 · Herdr · 登录 | A5 | claude 走 F1 修复后的 `unknown` + `attention` 通过；pi 分支不可测 |
| 端口 · herdr-core | B1、B2、B4、B6–B14、S1-d | 通过 |
| 端口 · herdr-core · 对话框 | B3（claude trust + 观看 tab 里回答）、B5（登录，备选分支） | 通过（G3 仍对 claude 记失败）；B3 的 pi 分支不适用 |
| Loop | C（单任务 Lane）、S1、S1-a、S1-b、S1-c、S1-e | 通过 |
| Loop · 并行 | C-3（Pi Parent） | 通过；Claude Code 并行组合未跑 |
| Loop · 插件副本 | C-1 | 通过（两份修复版共存）；旧安装副本仍冲突 |
| Loop · 连续 batch | F7 回归（同仓第 2、3 个 batch） | 通过 |
| Loop · Host 变体 | antigravity Executor、Claude Code Parent（后台 await） | 各通过一次 |
| Review / advisory | S2-a、S2-b、S2-c、S4-a | S2 全部通过；S4-a 的会话传输成立（reviewer 为 pi 时结算成功，claude 路径撞 F10） |
| Review / verifier | S3-a、S3-b、S3-c、S3-d | **未验证**（三次 material 尝试未产生 rework；第三次撞 F10） |
| Herdr 外 | S4-b | **未验证**（F9） |

### 2. 五个门的结论

| 门 | 结论 |
| --- | --- |
| G1 `probe` | 通过（两类 provider 均 `ok:true`，protocol 22） |
| G2 五步一轮 ≤60 s | 通过：Herdr 三 Host 6.6–11.2 s；herdr-core 2.1–3.0 s |
| G3 对话框 5 s 内 `blocked` | **部分**：权限（Herdr 4.3 s / core 2.1 s `status.kind=permission`）与 workspace trust（Herdr claude/agy）通过；登录对话框在两类 provider 上都不报 `blocked`，core 的 claude trust 也不报（改为 `attention` 保留终端） |
| G4 归属与不可用 | 通过：`not_owned`、Herdr 外 `provider_unavailable`、不新建 tab 或终端 |
| G5 Parent 不直调 `herdr` | 通过：Parent 会话 16 条 bash 调用无一条执行 `herdr tab/agent/pane` |

### 3. 缺陷清单与状态

| 编号 | 问题 | 状态 |
| --- | --- | --- |
| F1 | 登录 / 选择类对话框不报 `blocked`，Herdr 还会把 entry 打进对话框 | 已修（`attention` + 保留终端）；**登录框仍不报 `blocked`**，属上游/待根治 |
| F2 | `close` 只校验形式，不核对 batch record | 已修：必须带 `--batch`，按 `session_closes` 核对 |
| F6 | “集成后再请求关闭”不可执行 | 已改为“集成 tick 记录 `session_closes`”；第二轮曾误判为缺陷 |
| F7 | 首个 batch 之后新 batch 自锁 | 已修（创建前先写 `lane_reservation`），第三轮同仓连续 batch 验证通过 |
| C-1 | 显式 `-e` + 已安装 package 冲突退出 | 已修（按进程认领）；旧副本缺认领代码时仍会冲突 |
| **F8** | active 用户 profile 覆盖项目 `lanes.*`，预期 project 优先 | 非缺陷：优先级符合 ADR 0037，测试把键写错了层（`layered_config.ts:178-182`） |
| **F9** | Herdr 外非交互 Executor 与 `tui_required` 矛盾，批永不结算 | 已修：返回 `lane_executor_requires_tui`，子任务留在 `enrolled`；未实测 |
| **F10** | claude-code reviewer 的评审结论被判 coverage 不足，两轮后 park | 已修：根因是 `dontAsk` 拒绝 `git --no-pager`；真实模型复跑未做（BR-SCN-1） |
| **F11** | 用户级 PreToolUse hook 改写 git 命令，reviewer 的 git allow-list 全部失配 | 已修：claude-code reviewer/verifier 带 `--settings '{"disableAllHooks":true}'`；argv 级冒烟通过，完整 Review 复跑未做（BR-SCN-1） |
| **F12** | claude-code verifier 的 packet 在仓库外，`dontAsk` 拒绝 Read | 已修：verifier argv 带 `--add-dir <packet 目录>`；argv 级冒烟通过（v4 `smoke-args`），完整 Review 复跑未做（BR-SCN-1） |
| **F13** | claude-code reviewer 加载用户安装的旧版 skill，契约哈希不符 | 已修：reviewer argv 带 runtime 的 `--plugin-dir`；完整 Review 复跑待 v4 `probe-m2` 重新发起 |

### 4. 准入决定

- **herdr**：三 Host 的 G1、G2、G4 通过；G3 的权限与 trust 通过，登录一格对 Claude 仍不通过。Claude Code 在 herdr 上差“登录对话框”一项；Pi 与 Antigravity 的权限 / 登录未测。
- **herdr-core**：**无 Host 准入**。Claude Code 的 trust 与登录都不报 `blocked`；Pi 与 Antigravity 的权限 / 登录未测。
- **Loop**：单任务、并行、连续 batch 与 S1 关闭流程在 herdr 上可用；herdr-core 未接入 Loop（D2 不满足）。

### 5. 方法与限制

- Parent 以 Pi（`grok/grok-4.7@500k`）为主，Claude Code Parent 只跑了一次单任务变体（`auto mode` 下原生门被自动通过，非人工确认）；antigravity 模型在测试当日配额耗尽。
- “Herdr 外”用剥离 `HERDR_ENV` 的进程等价构造，非真正独立终端。
- 每次回收到的对话框（trust、权限、登录）都由用户本人回答；C-1 测试期间临时把本分支副本装到用户级，测试后已恢复原安装。
- 为跑 S3 临时加了用户级 profile `r4probe` 并切 active，结束后已还原为 `deepseek`。

### 6. 剩余工作

1. 用真实 claude-code reviewer 复跑 F10（BR-SCN-1）；在 Herdr 外实测 F9 的 `lane_executor_requires_tui`，并补测 `claude --print` 与 antigravity（BR-DEFER-2）。
2. 重跑 S3-a/b（含 `verifier_actor` / `verifier_model` / `model_relation`）、S3-c（verify tab 里 Ctrl+C）、S3-d（`review_transport: process`）、S4-b（`review_transport_unavailable`）。
3. 补测 Pi / Antigravity 的权限与登录对话框（需要各自 host 的隔离配置），以及 C-3 的 Claude Code 并行组合。
