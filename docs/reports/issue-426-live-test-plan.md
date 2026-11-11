# Issue #426 实测方案：Supervised Session Port 的 Herdr 与 herdr-core provider

日期：2026-11-10。对象：分支 `claude/affectionate-pascal-prxbzx`（提交 `0fe3f41a` 起）。目的：在真实运行时上确认 `docs/reports/issue-426-herdr-provider-probe.md` 中只做过源码与文档核对的结论，并给出 herdr-core 能否被 Loop 契约启用的依据（D2）。

## 0. 通过标准

| 门 | 内容 | 适用 |
| --- | --- | --- |
| G1 | `imm-session probe` 在真实环境返回 `ok: true` | 每个 provider |
| G2 | throwaway 会话走完 `create → observe → await → read → stop`，60 秒内完成，每一步的 JSON 与参考文档一致 | 每个 provider × 每个 Host |
| G3 | 对话框出现后 5 秒内，已挂起的 `await` 返回 `blocked` | 每个 provider × 每个 Host × 每类对话框 |
| G4 | 负向：不属于本会话的 handle 被拒绝（`not_owned`）；provider 不可用时什么都不启动 | 每个 provider |
| G5 | Loop 端到端：Parent 经 `imm-session` 跑完一个单任务 Lane，Kernel 结算为 `done`，Parent 没有直接调用 `herdr` | Herdr TUI（herdr-core 待 G1–G4 通过后再做） |

G2、G3 的数字沿用 #426 §6 的建议值。G5 是 S0 改写 Loop 契约后的行为不变性检查。`events_lost` 门不适用：两个 adapter 都未实现 `subscribeEvents`。

**herdr-core 启用条件：** 某个 Host 在 herdr-core 上通过 G1–G4，且三类对话框（权限、workspace trust、登录）都在 G3 内报 `blocked`。只有这样的 Host 才算准入；任何一类漏报，该 Host 在 core 上不准入。

## 1. 测试矩阵

| Provider | 版本 | Host（最低版本） |
| --- | --- | --- |
| `herdr` | Herdr TUI 0.9.5（协议 22） | Claude Code、Pi、Antigravity CLI（TUI 靠屏幕检测，无最低版本） |
| `herdr-core` | herdr-core 0.1.19 | Claude Code ≥ 2.1.295、Pi ≥ 1.1.0、Antigravity CLI ≥ 1.4.0 |

共 6 个组合。先 Claude Code 跑通全部用例，再换 Pi、Antigravity。

## 2. 安全与隔离（每次都遵守）

- 只在 throwaway 目录与 throwaway Git 仓库里运行，不碰真实项目。
- Herdr TUI：新建专用 workspace（例如 `imm-probe`），在它的 pane 里执行所有命令，tab 只会建在这个 workspace。
- herdr-core：每条命令都带 `HC_SESSION=imm-probe`，并把 `XDG_STATE_HOME`、`XDG_CONFIG_HOME`、`XDG_RUNTIME_DIR` 指向临时目录，得到独立的 core（`docs/security.md` “Sessions”；`SKILL.md` 要求测试使用独立 `HC_SESSION`）。**绝不对默认 session 执行 `hc server stop` 或 `restart`。**
- 对话框一律由测试者本人回答。任何脚本都不发 `--force`，也不向 `blocked` 会话发送按键。
- 权限模式保持 Host 默认值，不加 `--dangerously-skip-permissions` 一类参数，否则 G3 无从触发。

## 3. 准备

```sh
# 1) 本分支与运行时
git clone -b claude/affectionate-pascal-prxbzx https://github.com/dereknex/immune-brain ~/imm-probe/immune-brain
cd ~/imm-probe/immune-brain && bun install --frozen-lockfile
export IMM="$HOME/imm-probe/immune-brain/plugins/immune-brain/bin/imm-session"

# 2) 版本记录（写进结果表）
herdr --version; hc --version; claude --version; pi --version; agy --version; bun --version

# 3) throwaway 目录
mkdir -p ~/imm-probe/lanes/trusted ~/imm-probe/evidence
# 在 trusted 目录里分别手动启动一次 claude / pi / agy 并接受 workspace trust，然后退出。
# A3/B3 另用每次新建、从未信任过的目录。

# 4) herdr-core 隔离环境（只在 B 阶段使用）
export HC_SESSION=imm-probe
export XDG_STATE_HOME=$HOME/imm-probe/xdg/state XDG_CONFIG_HOME=$HOME/imm-probe/xdg/config XDG_RUNTIME_DIR=$HOME/imm-probe/xdg/run
mkdir -p "$XDG_STATE_HOME" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
```

每条 `imm-session` 命令都用下面的包装记录时间戳与原始输出：

```sh
rec() { local tag=$1; shift; printf '%s %s\n' "$(date +%s.%N)" "$tag" >> ~/imm-probe/evidence/timeline.log
        "$@" | tee ~/imm-probe/evidence/$tag.json; printf '%s %s-end\n' "$(date +%s.%N)" "$tag" >> ~/imm-probe/evidence/timeline.log; }
```

## 4. 阶段 A：Herdr TUI（在 `imm-probe` workspace 的 pane 里执行）

前置：`echo $HERDR_ENV $HERDR_WORKSPACE_ID` 输出 `1` 和非空 ID。下文 `H=claude-code|pi|antigravity`。

| 用例 | 步骤 | 期望 | 门 |
| --- | --- | --- | --- |
| A1 准入 | `rec A1 $IMM probe --provider herdr` | `{"ok":true,"provider":"herdr","missing_optional":[...]}`；另记录 `herdr api schema --json` 的顶层 `protocol`（应为 22） | G1 |
| A2 正常一轮 | `rec A2-create $IMM create --provider herdr --cwd ~/imm-probe/lanes/trusted --label probe-a2 --host $H --entry "Reply with exactly READY. Do not run any tool."`；随后依次执行 `observe <h>`、`await <h>`、`read <h> --source visible`、`stop <h>` | create 返回 `entry_submitted:true`、`state:"working"`；新 tab 出现在 `imm-probe` workspace 且焦点不变；`await` 返回 `changed` 与 `idle` 或 `done`；`read` 文本里有 `READY`；`stop` 后 pane 关闭 | G2 |
| A3 workspace trust | 新建从未信任的目录，以它为 `--cwd` 执行 create | create 返回 `entry_submitted:false`、`state:"blocked"`；测试者接受 trust 后，`create --resume <h> ...` 提交 entry | G3 |
| A4 权限对话框 | 在 trusted 目录 create，entry 为 `Use your shell tool to run: touch imm-probe-permission.txt, then reply DONE.`；create 返回后立刻后台执行 `rec A4-await $IMM await <h> --provider herdr &`，另一个 shell 每 0.5 秒执行一次 `observe` 并记录首次出现 `blocked` 的时间 | `await` 返回 `blocked`；await 返回时间减去首次 observe 到 `blocked` 的时间 ≤ 5 秒；测试者拒绝权限后会话回到 `working` 或 `idle` | G3 |
| A5 登录对话框（可选） | 用 `create --env`：Claude Code 加 `--env CLAUDE_CONFIG_DIR=<空临时目录>`；Pi 加 `--env PI_CODING_AGENT_DIR=<空临时目录>`。Antigravity 若无安全的隔离方式，记“未测”并写明原因 | 返回 `blocked`（create 时为 `entry_submitted:false`） | G3 |
| A6 指令与 `done` | A2 的会话结束一轮后先 `observe`，记录是 `idle` 还是 `done`；然后 `send <h> --provider herdr --text "Reply with exactly AGAIN."` | O1 已修：`done` 与 `idle` 都应投递成功，`read` 里出现 `AGAIN` | O1 |
| A7 `unknown` 唤醒 | 在 tab 里退出 Host，回到 shell，然后执行 `await <h>` | 返回 `exited`（`agent_not_running` / `agent_not_found`），或返回 `changed` 加 `unknown`，两者之一；不得一直挂起 | G2 |
| A8 负向 | `observe "herdr:other-ws/t1/p1" --provider herdr` 返回 `not_owned`；在 Herdr 外的普通终端执行 `probe` 和 `create`，返回 `provider_unavailable`，且 Herdr 里没有新 tab | 两项都符合 | G4 |
| A9 所有权（K1 已修） | 记下 A2 create 返回的 handle 与新 tab 的标签（应形如 `probe-a2 [imm:<12 位十六进制>]`）。再用测试者自己 shell 所在 pane 拼 `herdr:$HERDR_WORKSPACE_ID/<tab>/<pane>/guessed`，以及把 A2 handle 的 token 改错，分别执行 `observe` 与 `stop` | 都返回 `not_owned`，测试者的 pane 不受影响 | K1 |
| A10 Host 退出后原地重启（C-2 已修） | A2 会话里退出 Host 回到 shell，执行 `create --resume <h> --provider herdr --cwd ... --label probe-a2 --host $H --entry "Reply with exactly BACK."` | 不新增 tab，同一 pane 里 Host 重新启动并收到 entry，`read` 里出现 `BACK`；记录 `agent get` 在 Host 退出后的错误码 | C-2 |

每个 Host 都跑 A1–A8；A9 只需跑一次。

## 5. 阶段 B：herdr-core（在第 3 节的隔离环境里执行）

| 用例 | 步骤 | 期望 | 门 |
| --- | --- | --- | --- |
| B1 准入 | `rec B1 $IMM probe --provider herdr-core`；另保存 `hc schema --json` 的 `info` 字段与 `hc server status --json` | `ok:true`；`info.version` ≥ 0.1.19，`info.description` 含 “Protocol generation 1” | G1 |
| B2 正常一轮 | 同 A2，`--provider herdr-core`。另保存 `hc get <address> --json` 的原始输出 | `hc ls` 里只多一个终端，带标签 `imm-session=<token>`；create 返回 `entry_submitted:true`；`observe` 的 provenance 为 `reported`；`await` 返回 `changed`；`stop` 后终端为 `finished` | G2 |
| B3 workspace trust | 同 A3 | 首次上报为 `blocked`，create 返回 `entry_submitted:false`；回答后 `create --resume` 提交 entry。Claude Code 2.1.322 已知不上报：30 秒后返回 `entry_submitted:false`、`state:"unknown"` 与含 `hc attach <address>` 的 `attention`，终端保留；用户在 `hc attach` 里接受 trust 后 `--resume` 应提交 entry（G3 对该 Host 仍记失败） | G3 |
| B4 权限对话框 | 同 A4。另保存 `hc get --json` 的 `status`，应为 `{state:"blocked",kind:"permission"}` | ≤ 5 秒 | G3 |
| B5 登录对话框 | 同 A5 | `blocked`，或者 30 秒内没有上报。后者说明该 Host 不报登录状态，在 core 上不准入 | G3 |
| B6 首次上报与就绪 | B2 期间每 0.2 秒执行一次 `hc get --json`，记录首个 `status.state` 及其距 `hc run` 的秒数 | 首个上报为 `idle`，且在 30 秒内（观察 O2） | O2 |
| B7 指令与 `done` | 同 A6 | O1 已修：`done` 时 adapter 发不带 `--if` 的 `send`，投递成功；`idle` 时带 `--if idle` | O1 |
| B8 版本门 | 把 PATH 临时指向一个打印旧版本号的 `claude` 包装脚本，然后 create | `provider_unavailable`，`hc ls` 没有新终端 | G4 |
| B9 所有权 | 用 `hc run --bg --json -- sh` 自建一个终端，拼 handle `herdr-core:<address>/guessed` 执行 `observe` 和 `stop` | 都返回 `not_owned`；该终端仍在运行 | G4 |
| B10 无上报 | `--host` 选一个旧版本 Host（或对 Pi 设 `PI_PROGRAM_STATUS=0`、对 Antigravity 设 `AGY_CLI_OSC7501=off`），关闭版本门不可行时只做环境变量这一种 | 30 秒后 `entry_submitted:false`、`state:"unknown"`，带 `attention`，entry 未发送，终端保留 | G4 |
| B12 已结束终端的 resume（C-2） | B2 会话 `stop` 之后执行 `create --resume <h> --provider herdr-core ...` | `state_refused`，原因写明需新建会话；`hc ls` 没有新终端 | C-2 |
| B11 长等待 | 对一个正在工作的会话执行不带 `--timeout-ms` 的 `await`，让一轮工作超过 3 分钟（例如让 Host 运行 `sleep 200` 并批准权限） | 跨过 core 180 秒的 check-in 后继续等待，直到真正的状态变化才返回 | G2 |

收尾：`hc ls` 列出的每个终端都 `hc kill` 并 `hc rm`；最后 `HC_SESSION=imm-probe hc server stop`。这里停的是隔离的 core，不是默认 session。

## 6. 阶段 C：Loop 端到端（Herdr TUI）

1. 建一个 throwaway Git 仓库，放一个 routine TaskIntent，例如“在 README 末尾加一行 `probe`”，acceptance 为 `grep -q '^probe$' README.md`。用 `draw-up` 生成并提交。
2. 在 `imm-probe` workspace 的 pane 里，用本分支的插件启动 Parent，例如 `claude --plugin-dir ~/imm-probe/immune-brain/plugins/immune-brain`，然后执行 `/immune-brain:drive <task_id>`。
3. 期望：
   - native gate 打开一次；
   - Parent 调用 `imm-session create`，创建一个不抢焦点的新 tab；
   - Parent 以后台命令挂起 `imm-session await`；
   - child 结算后 Parent 重新进入，Kernel 结算为 `done`，交付符合 `git_integration` 设置。
4. 证据：保存 Parent 的会话记录，检查其中**没有**直接执行 `herdr tab|agent|pane` 的命令（G5）。保存 batch report 中的 `lane_supervision` 与 `interventions`。
5. 对三个 Executor Host 各跑一次，通过 Lane Preferences 的 `executor_host` 指定。
6. C-1：在装有用户级 Immune-Brain Pi package 的机器上，让 Parent 以本地插件目录启动 Pi Executor（`-e <插件目录>`）。期望 Executor 不退出，Pi 里出现一次“已从 <目录> 加载”的提示，工具行为来自 `-e` 那份。
7. C-3：分别用 Claude Code 与 Pi 作 Parent 各跑一次。Claude Code 应以后台命令挂起 `imm-session await`；Pi 应在前台运行带 `--timeout-ms 600000` 的 `imm-session await <handle>...`，`timeout` 返回后调 `start_unattended_batch` 再等。并行 batch（`max_parallel` 2）时一次 `await` 覆盖两个 Lane，返回的 `handle` 对应先变化的那个；Parent 返回后用 `ps` 确认没有残留的 `herdr agent wait` 进程。

## 7. 重点观察与已知缺口

- **O1：`done` 与指令规则。** port 只允许向 `idle` 会话发送指令。Herdr 文档说 `done` 是“空闲但未被查看”，只有聚焦才变成 `idle`，读输出不算（`cli-reference.mdx` 第 361 行）。core 的 `--if idle` 也只认精确的 `idle`。如果一轮结束后会话停在 `done`，Parent 的纠正指令会一直被拒绝。实测确认后，建议把 port 的指令规则放宽为 `idle` 或 `done`：Herdr 文档说两者都表示可以输入。对应地，core 对 `done` 只能先查后发，因为 `--if` 不接受 `done`。
- **O2：首次上报。** herdr-core adapter 只在看到 `idle` 后提交 entry。若某个 Host 启动后第一次报的不是 `idle`（例如直接报 `done`），create 会在 30 秒后 `start_failed`。实测确认后，再决定是否把 `done` 也当作就绪。
- **O3：对话框覆盖。** 三个 Host 的上游说明都没有逐一列出对话框种类。A3–A5、B3–B5 的结果直接决定准入。
- **O4：时延。** 记录 G2、G3 的实际耗时，写回 #426 §6 建议值的讨论。
- **K1（已修，待实测）：** Herdr adapter 原先只比对 workspace。现在 token 写进 tab label 并编进 handle，每个动词先 `pane get` 与 `tab get` 核对；A9 期望 `not_owned`。

## 8. 记录与回写

每个用例在结果表填一行：

| 日期 | Provider | Host 与版本 | 用例 | 结果（通过/失败/未测） | 关键数据（状态序列、耗时） | 证据文件 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |

证据保存在 `~/imm-probe/evidence/`（`*.json` 与 `timeline.log`）。完成后：

1. 把结果表与 O1–O4 的结论追加到 `docs/reports/issue-426-herdr-provider-probe.md`，说明每条“源码核对”结论被证实还是被推翻。
2. 按结果修改代码：O1、O2、K1，以及任何与参考文档不符的命令写法或返回形状（只改 adapter 的命令表与解析）。
3. 更新 `docs/reference/supervised-session-port.md` 的准入矩阵：只把 G1–G4 全过、三类对话框都报 `blocked` 的 Host 标为 core 上准入。
4. 至少有一个 Host 在 herdr-core 上准入之后，再设计 Loop 契约里显式选择 herdr-core 的配置项（不自动探测），并对它做阶段 C。

## 补充用例：S1 Executor 关闭权

| 用例 | 步骤 | 期望 |
| --- | --- | --- |
| S1-a 未集成不关 | child 仍在运行时，Parent 调 `start_unattended_batch` 带 `lane_session_close: {task_id}` | `accepted: false`，原因含 “not integrated”；tab 不关 |
| S1-b 集成后关闭 | child `integrated` 且等待返回 `idle`/`done`/`exited` 后，同一请求得到 `accepted: true` 与 `recorded_at`；再执行 `imm-session close <handle> --provider herdr --task <task_id> --recorded-at <recorded_at>` | 只关这个 tab；batch report 的 `session_closes` 含该 child；Lane 目录与分支仍在 |
| S1-c 重复与伪造 | 再请求一次；以及不带或伪造 `--recorded-at` 直接 `imm-session close` | 第二次 `accepted: false`（already recorded）；伪造记录得 `close_unproven`，什么都不关 |
| S1-d herdr-core | 同 S1-b，`--provider herdr-core` | 终端先 `kill` 后 `rm`，`hc ls --all` 中不再有它 |
