# Issue #426 本地验证计划

被测版本：分支 `claude/affectionate-pascal-prxbzx`，提交 `8802d75b` 或之后（第三轮；第二轮用的是 `3bc4b29d`）。用途：在真实的 Herdr、herdr-core 与三个 Executor Host 上，验证 #426 的全部交付（Supervised Session Port、S0–S4、verification CLI 阶段）。本文件可从头到尾照做；用例的来由与判定依据见 `docs/reports/issue-426-live-test-plan.md`，结论回写到 `docs/reports/issue-426-herdr-provider-probe.md`。

总耗时约 6–7 小时，分 6 轮。第 5 轮（herdr-core）可选。任何一轮触发“停止条件”时，先停下，把证据交回修复，再继续。

---

## 0. 总览

| 轮 | 内容 | 主要用例 | 时长 | 依赖 |
| --- | --- | --- | --- | --- |
| R0 | 环境与仓库准备 | — | 30 分钟 | — |
| R1 | Herdr TUI 会话层回归 | A1–A3、A6–A10、S4-c | 60 分钟 | R0 |
| R2 | 对话框覆盖（G3） | A4、A5 | 45 分钟 | R1 |
| R3 | Loop 端到端 | C、C-1、C-3、S1 | 120 分钟 | R1 |
| R4 | Review / verifier / advisory 走会话 | S4-a/b、S3-a–d、S2-a–c | 90 分钟 | R3 |
| R5 | herdr-core（可选） | B1–B12、S1-d | 90 分钟 | R0 |

### 0.1 第三轮：只跑这些（约 3.5 小时）

第二轮已确认的项（K1、O1、C-2、`--env`、G3 权限框、G5）不必重跑。第三轮验证第二轮之后的修复（`docs/reports/issue-426-herdr-provider-probe.md`“修复（第二轮实测之后）”）以及 R3、R4 中没能进入的部分：

| 顺序 | 用例 | 验证的修复 | 位置 |
| --- | --- | --- | --- |
| 1 | R0 2.1（更新到新提交）、2.5（新建仓库 L） | — | §2 |
| 2 | A5 登录框（只测 Claude） | F1：不再 `provider_error`，改为 `attention`，tab 保留 | §5 |
| 3 | 6.1 单任务 Lane 加 S1-a、S1-b、S1-c | F6、F2：集成那次就记录关闭，`close` 核对 batch record | §6.1 |
| 4 | 6.4 连续新 batch | F7：第一个 batch 之后的 batch 都能起来 | §6.4 |
| 5 | 6.2 并行 batch | C-3、多 handle await、S1 关两个 tab | §6.2 |
| 6 | 6.3 C-1 | 进程级单副本认领 | §6.3 |
| 7 | R4 全部 | S2、S3、S4 走会话 | §7 |
| 8 | R5 的 B2、B3、B13、B14、S1-d（在 Herdr 内） | herdr-core 观看 tab | §8 |

全程留意第 3 节新增的 Parent 停止条件。

通过标准（全部来自 #426 §6）：

| 门 | 内容 |
| --- | --- |
| G1 | `imm-session probe` 返回 `ok: true` |
| G2 | 一个临时会话走完 create → observe → await → read → stop，60 秒内，每一步 JSON 与参考文档一致 |
| G3 | 对话框出现后 5 秒内，挂起的 `await` 返回 `blocked`；权限、workspace trust、登录三类各测 |
| G4 | 不属于本会话的 handle 被拒（`not_owned`）；provider 不可用时什么都不启动 |
| G5 | Parent 经 `imm-session` 跑完单任务 Lane，Kernel 结算 `done`，Parent 从不直接执行 `herdr` |

## 1. 前提

**软件**（记录实际版本）：Herdr TUI 0.9.5；herdr-core `hc` 0.1.19（仅 R5）；Claude Code ≥ 2.1.295；Pi ≥ 1.1.0；Antigravity CLI ≥ 1.4.0；`bun`；`git`；`jq`。

**账号与额度**：Claude 有可用额度（R2、R4 需要它弹出权限框与执行 Review）。

**权限设置**：至少让 Pi 或 Antigravity 中的一个在执行 shell 命令前需要确认（上一轮两者都自动放行，权限框无法触发）。具体设置方式按该 Host 自己的配置文档，改完后手动验证一次“执行 shell 会弹框”。

**安全规则（全程遵守）**

- 只在 `~/imm-probe/` 下的临时目录和临时仓库里操作。
- 所有 Herdr 操作都在专用 workspace `imm-probe` 的 pane 里执行。
- herdr-core 只用隔离的 `HC_SESSION=imm-probe`，**绝不**对默认 session 执行 `hc server stop` / `restart`。
- 对话框一律由你本人回答；任何命令都不加 `--force`；Host 保持默认权限模式（不加 `--dangerously-skip-permissions`）。

## 2. R0：准备

### 2.1 代码与工具

```sh
mkdir -p ~/imm-probe/evidence && cd ~/imm-probe
git clone -b claude/affectionate-pascal-prxbzx https://github.com/dereknex/immune-brain
cd immune-brain && git log --oneline -1          # 记下提交号
bun install --frozen-lockfile
export IB=~/imm-probe/immune-brain
export IMM=$IB/plugins/immune-brain/bin/imm-session
export KERNEL=$IB/plugins/immune-brain/bin/imm-kernel
export EV=~/imm-probe/evidence
{ herdr --version; hc --version; claude --version; pi --version; agy --version; bun --version; git --version; } > $EV/versions.txt 2>&1
```

证据记录函数（每个新 shell 都要先粘贴）：

```sh
rec() { local tag=$1; shift
  printf '%s START %s\n' "$(date +%s.%N)" "$tag" >> $EV/timeline.log
  "$@" | tee $EV/$tag.json
  printf '%s END %s\n' "$(date +%s.%N)" "$tag" >> $EV/timeline.log; }
```

### 2.2 让三个 Host 加载本分支的插件

- Claude Code：Parent 用 `claude --plugin-dir $IB/plugins/immune-brain` 启动。
- Antigravity：`agy plugin install $IB/plugins/immune-brain-antigravity`，再 `agy plugin validate $IB/plugins/immune-brain-antigravity --strict`。
- Pi：按你平时的方式让 Pi 加载 `$IB` 这个 package（`package.json` 的 `pi.skills` / `pi.extensions`）。R3 的 C-1 用例需要“用户级已安装一份 + 本地目录再传一份”，那一步单独说明。

### 2.3 Herdr workspace

在 Herdr 里执行 `herdr workspace create --label imm-probe --focus`，之后的 R1–R4 都在这个 workspace 的 pane 里进行。进入 pane 后确认：

```sh
echo "$HERDR_ENV $HERDR_WORKSPACE_ID"     # 期望：1 和一个非空 ID
```

### 2.4 会话层用的目录（仓库 P）

```sh
mkdir -p ~/imm-probe/p/trusted
# 在 trusted 目录里分别手动启动一次 claude、pi、agy，接受 workspace trust（若有）后退出。
newdir() { d=~/imm-probe/p/untrusted-$(date +%s%N); mkdir -p "$d"; echo "$d"; }   # 每次给出一个从未信任的目录
```

### 2.5 Loop 用的仓库（仓库 L）

```sh
mkdir -p ~/imm-probe/L && cd ~/imm-probe/L && git init -q && git config user.email probe@example.com && git config user.name probe
printf '# probe repo\n' > README.md
mkdir -p .imm && cat > .imm/config.json <<'JSON'
{ "contract": "immune_brain/project_config/v1",
  "git_integration": "manual",
  "initiative_carrier": "local",
  "lanes": { "review_host": "claude-code" } }
JSON
# 让本仓库使用 TaskIntent 路由（必须是这份规范字节，sha256 应为 43949f0e…ec71e）
mkdir -p docs/plans && printf '{\n  "contract": "immune_brain/managed_task_routing_policy/v1",\n  "revision": 1,\n  "new_task_route": "kernel_task_intent",\n  "v3_new_plan_sync": "retired",\n  "legacy_v3_mode": "drain_read_only",\n  "terminal_import": "disabled"\n}\n' > docs/plans/managed-task-routing-policy.json
sha256sum docs/plans/managed-task-routing-policy.json
git add -A && git commit -qm "probe base"
```

生成 TaskIntent 的函数（一个 task id 只能执行一次，每个用例用新 id）：

```sh
desc() { printf '{"contract":"assurance_kernel/verification_descriptor/v2","command":{"executable":"%s","argv":%s,"cwd":".","timeout_ms":180000,"max_output_bytes":196608},"environment":{"prepare":null,"writable_paths":[]}}' "$1" "$2"; }
routine() {   # routine <id> <word>：在 README.md 末尾加一行 <word>
  local v; v=$(desc sh "[\"-c\",\"grep -qx $2 README.md\"]")
  jq -n --arg id "$1" --arg w "$2" --arg v "$v" '{contract:"assurance_kernel/task_intent/v1",task_id:$id,owner:"user",
    goal:("Append one line containing exactly `"+$w+"` to README.md."),risk:"routine",revision:1,scope_hint:["README.md"],
    acceptance:[{id:"A1",assertion:("README.md has a line that is exactly "+$w),verification:$v}]}' \
  | $KERNEL intent author docs/plans/$1.intent.json --stdin --json
  git add docs/plans/$1.intent.json && git commit -qm "intent $1"; }
material() {  # material <id>：需要 Review 的任务
  local v; v=$(desc bun '["test","tests/clamp.test.ts"]')
  jq -n --arg id "$1" --arg v "$v" '{contract:"assurance_kernel/task_intent/v1",task_id:$id,owner:"user",
    goal:"Add src/clamp.ts exporting clamp(n, min, max) that bounds n to [min, max] and throws a RangeError when min > max, with tests in tests/clamp.test.ts.",
    risk:"material",revision:1,scope_hint:["src/clamp.ts","tests/clamp.test.ts"],
    acceptance:[{id:"A1",assertion:"clamp bounds values and rejects min > max",verification:$v}]}' \
  | $KERNEL intent author docs/plans/$1.intent.json --stdin --json
  git add docs/plans/$1.intent.json && git commit -qm "intent $1"; }
```

期望：`author` 输出带 `content_hash` 的结果（此时 `git_tracked: false`、`enrollment_ready: false` 属正常，因为文件尚未提交）；函数随后提交，之后 `$KERNEL intent validate docs/plans/<id>.intent.json --json` 应为 `"valid": true`。若 `author` 报 `intent_authoring_not_routed`，说明上面的路由策略文件没有提交或字节不一致。这两个函数已在本分支上用 `imm-kernel` 实际跑过。

## 3. 记录与停止规则

每个用例记一行到 `$EV/results.md`：

```text
| 日期 | 轮/用例 | Provider | Host+版本 | 结果(通过/失败/未测) | 关键数据(状态序列、耗时、错误码) | 证据文件 | 备注 |
```

**停止条件**（任一出现即停，打包 `$EV` 交回）：

- 任何“不属于本会话”的 handle 被当成自己的（A9、B9）。
- `imm-session` 输出的 JSON 字段与本文期望不一致（例如没有 `handle`、`state` 不在五种状态内）。
- Parent 的会话里出现直接执行 `herdr tab|agent|pane` 的命令。
- Kernel 结算出现预期之外的 `stopped` 或批次 `failed`。
- Parent 在自己的会话或 checkout 里动手实现子任务，或执行 `git reset`、`git branch -D`、`git worktree remove`、`git worktree prune`（契约已禁止；即使只是“打算”执行也记下原话）。
- 任何新 batch 的 child 以 `batch_worktree_failed … no recorded Lane binding` 或 `does not match its recorded reservation` 停住（F7）。

## 4. R1：Herdr TUI 会话层回归

在 `imm-probe` workspace 的 pane 中执行。对 `H` 依次取 `claude-code`、`pi`、`antigravity`，每个 Host 跑一遍 A1–A10（A3 对 Pi 记“不适用”）。

| 用例 | 步骤 | 期望 |
| --- | --- | --- |
| A1 准入 | `rec A1 $IMM probe --provider herdr`；另 `herdr api schema --json \| jq .protocol` | `{"ok":true,"provider":"herdr",...}`；protocol 为 `22` |
| A2 正常一轮 | `rec A2-$H $IMM create --provider herdr --cwd ~/imm-probe/p/trusted --label probe-a2 --host $H --entry "Reply with exactly READY. Do not run any tool."` 记下 `handle` 为 `$HD`；然后依次 `rec A2-observe $IMM observe "$HD" --provider herdr`、`rec A2-await $IMM await "$HD" --provider herdr`、`rec A2-read $IMM read "$HD" --provider herdr --source visible`、`rec A2-stop $IMM stop "$HD" --provider herdr` | create 返回 `entry_submitted: true`、`state: "working"`；新 tab 出现在 `imm-probe` 中且**焦点不变**；tab 名形如 `probe-a2 [imm:<12 位十六进制>]`；await 返回 `changed` 且 `idle` 或 `done`；read 的 `text` 含 `READY`；stop 后 pane 关闭；总时长 ≤ 60 秒（G2） |
| A6 `done` 也能收指令 | 重新 create 一个会话（同 A2），等 await 返回后 `rec A6-observe ...observe`，再 `rec A6-send $IMM send "$HD" --provider herdr --text "Reply with exactly AGAIN."`，再 await、read | observe 为 `idle` 或 `done`；send 返回 `ok: true`；read 含 `AGAIN` |
| A9 归属 | 记下你**自己 shell 所在 pane** 的 tab/pane ID（`herdr pane current`），拼 `herdr:$HERDR_WORKSPACE_ID/<tab>/<pane>/guessed`，执行 `observe` 与 `stop`；再把 A6 的 handle 最后一段改成 `000000000000`，执行 `observe` | 全部 `ok: false`、`code: "not_owned"`；你的 pane 不受影响 |
| A10 Host 退出后原地重启 | 在 A6 的 tab 里退出 Host（回到 shell），执行 `rec A10-get herdr agent get <pane>`（记录错误码），再 `rec A10 $IMM create --provider herdr --resume "$HD" --cwd ~/imm-probe/p/trusted --label probe-a2 --host $H --entry "Reply with exactly BACK."`，然后 await、read | 不新建 tab；同一 pane 里 Host 重新启动；read 含 `BACK`。记下 `agent get` 的错误码（期望 `agent_not_found` 或 `agent_not_running`） |
| A3 workspace trust | `D=$(newdir)`，以 `--cwd "$D"` 执行 A2 的 create | 返回 `entry_submitted: false`、`state: "blocked"`；在 tab 里接受 trust 后，`create --resume "$HD" ...` 返回 `entry_submitted: true` |
| A7 `unknown` 唤醒 | 新建会话后在 tab 里退出 Host，执行 `rec A7 $IMM await "$HD" --provider herdr --timeout-ms 20000` | 返回 `exited`，或 `changed` 加 `unknown`；不得挂满 20 秒后才以 `timeout` 返回 |
| A8 负向 | `$IMM observe "herdr:other-ws/t1/p1/x" --provider herdr`；再到 **Herdr 外**的普通终端执行 `$IMM probe --provider herdr` 与一次 create | 前者 `not_owned`；Herdr 外两者都是 `provider_unavailable`，Herdr 里没有新 tab（G4） |
| S4-c 命令会话 | `rec S4c $IMM run --provider herdr --cwd ~/imm-probe/p/trusted --label run-probe -- sh -c 'echo hello; sleep 2; exit 3'` | 新 tab 中能看到命令运行；**2 秒后**才返回 `{"ok":true,"exit_code":3,...}`。若立即返回，说明 `pane wait-output` 匹配到了命令回显，停止 |

R1 结束时用 `herdr tab list --workspace "$HERDR_WORKSPACE_ID"` 截一份清单存入 `$EV/R1-tabs.json`，然后手动关掉测试 tab。

## 5. R2：对话框（G3）

| 用例 | 步骤 | 期望 |
| --- | --- | --- |
| A4 权限框 | 对 Claude 以及“已改为需确认”的 Pi 或 Antigravity：在 trusted 目录 create，entry 为 `Use your shell tool to run: touch imm-probe-permission.txt, then reply DONE.`；create 返回后立刻在后台挂等待并在另一循环里打点：<br>`($IMM await "$HD" --provider herdr; date +%s.%N) > $EV/A4-await.txt &`<br>`while :; do s=$($IMM observe "$HD" --provider herdr \| jq -r .state); echo "$(date +%s.%N) $s" >> $EV/A4-observe.log; [ "$s" = blocked ] && break; sleep 0.5; done` | await 返回 `blocked`；`A4-await.txt` 的时间戳减去 `A4-observe.log` 中第一次 `blocked` 的时间 ≤ 5 秒；你拒绝权限后会话回到 `working` 或 `idle` |
| A5 登录框 | Claude：`D=$(mktemp -d)`，create 加 `--env CLAUDE_CONFIG_DIR=$D`；Pi：加 `--env PI_CODING_AGENT_DIR=$(mktemp -d)`。Antigravity 若没有安全的隔离方式，记“未测”并写明原因 | 理想结果是 `entry_submitted: false`、`blocked`。第二轮 Claude 得到的是 `provider_error`（Herdr 把 entry 打进了登录框，`agent_prompt_stalled`）；修复后（F1）应返回 `ok: true`、`entry_submitted: false`、`state: "unknown"`、`attention` 含 `do not send the entry again`，tab 保留、登录框仍在。截图记下 entry 文本是否出现在登录框里。仍得 `provider_error` 即失败。若 Host 正常启动没有登录框，说明环境变量未传到 Host，记失败 |

## 6. R3：Loop 端到端（仓库 L）

在 `imm-probe` workspace 新开一个 pane，`cd ~/imm-probe/L`。每个子用例用新的 task id。

### 6.1 单任务 Lane（C、S1）

1. `routine probe-c1 c1`。
2. Pi 作 Parent（加载本分支 package），在 Pi 里执行 `/skill:drive probe-c1`。
3. 期望：原生确认门打开一次，你确认；Parent 调 `imm-session create --provider herdr ...`，出现一个不抢焦点的新 tab；Parent **在前台**运行带 `--timeout-ms 600000` 的 `imm-session await`（C-3：Pi 不能后台唤醒）；Executor 完成后 Parent 重新进入，Kernel 结算 `done`。
4. S1（流程已改，F6）：把 child 集成的那一次 `start_unattended_batch` 返回的 report 里已带 `session_closes: [{"task_id":"probe-c1","at":"…"}]`，batch 可能同时已 `completed`；Parent **不再**重新进入 batch 去请求关闭，而是在协调 checkout（`~/imm-probe/L`）里直接执行 `imm-session close <handle> --provider herdr --batch <batch_id> --task probe-c1 --recorded-at <at>`。期望：该 tab 被关闭；`jq .session_closes ~/imm-probe/L/.imm/state/batches/<batch_id>.json` 含 `probe-c1`；Lane 目录与 `imm-lane/...` 分支仍在（`git worktree list`、`git branch -a`）。若 Parent 仍去请求 `lane_session_close` 并得到 `batch_parent_branch_exists`，记失败。
5. 证据：保存 Parent 的会话记录到 `$EV/C1-parent.txt`，执行 `grep -nE 'herdr (tab|agent|pane) ' $EV/C1-parent.txt`，期望**无输出**（G5）。

再用 **Claude Code** 作 Parent（`claude --plugin-dir $IB/plugins/immune-brain`，执行 `/immune-brain:drive probe-c2`，先 `routine probe-c2 c2`），期望 Parent 以**后台命令**挂 `imm-session await`。

再在 `.imm/config.json` 的 `lanes` 加 `"executor_host": "antigravity"` 并提交，用 `routine probe-c3 c3` 跑一次，确认 Executor tab 里运行的是 `agy`。跑完把该键删掉并提交。

S1 补充：

| 用例 | 步骤 | 期望 |
| --- | --- | --- |
| S1-a | 在 probe-c2 运行中（child 未集成）让 Parent 尝试关闭：直接对 Parent 说“现在对 probe-c2 请求 lane_session_close” | `accepted: false`，原因含 `not integrated`；tab 未关 |
| S1-b | probe-c2 集成后，记下 report 的 `batch_id` 与 `session_closes[0].at` | 不需要额外请求，`session_closes` 已含 `probe-c2`；Parent 按第 4 步关闭 |
| S1-c | 关闭**之前**，在 `~/imm-probe/L` 手动执行三次伪造：① `$IMM close <handle> --provider herdr --task probe-c2 --recorded-at <at>`（缺 `--batch`）；② 加 `--batch <batch_id>`，但 `--recorded-at 2020-01-01T00:00:00.000Z`；③ 正确的 `--batch` 与 `--recorded-at`，但 `--task probe-c1`（另一个任务） | ① 退出码 2（用法错误）；② ③ 都是 `close_unproven`，原因含 `records no session close`；三次 tab 都还在。之后让 Parent 按第 4 步关闭成功 |
| S1-e | 再对同一个 batch 说一次“对 probe-c2 请求 lane_session_close”（只在 batch 还在 `running` 时可做；已 `completed` 则记“不适用”） | 返回 `accepted: true`，`recorded_at` 与 `session_closes` 中已有的 `at` 相同，不新增记录 |

### 6.2 并行 batch（C-3）

1. 在 `.imm/config.json` 的 `lanes` 加 `"max_parallel": 2` 并提交。
2. 在 Claude Code Parent 中执行 `/immune-brain:draw-up`，要求生成一个**本地** Initiative，包含两个互不依赖的 routine slice：在 `a.txt` 写入 `alpha`、在 `b.txt` 写入 `beta`。
3. 执行 `/immune-brain:drive <initiative>`。
4. 期望：同时出现两个 Executor tab；Parent 的 `imm-session await` 一次带上两个 handle，返回的 JSON 含先变化那个会话的 `handle`；每个 child 集成的那次 report 都在 `session_closes` 里加上它，Parent 用 `close --batch` 逐个关闭两个 tab，不重新进入已完成的 batch。
5. 结束后执行 `ps aux | grep -E 'herdr agent wait|pane wait-output' | grep -v grep`，期望**无输出**。
6. 用 Pi 作 Parent 重复第 3–5 步（新 Initiative），期望 Pi 在前台分轮等待。

### 6.3 C-1：同一插件两份

1. 让 Pi 在**用户级**安装一份本分支的 Immune-Brain package（与 2.2 的加载方式并存）。
2. 用 Pi 作 Parent，从本地目录加载插件，跑 `routine probe-c4 c4`。
3. 期望：Executor **不加** `-ne -ns` 也能启动，不出现 `Failed to load extension … conflicts with …`，不退出（第二轮这里失败，现已改为按进程认领）；Executor tab 中出现一次提示“Immune-Brain is already loaded from <-e 的目录>; the copy at <用户级 package 目录> was not loaded”；任务正常结算。若仍报 conflicts，记下完整报错，并记下 `pi --version` 与用户级 package 的安装路径。
4. 再在一个普通 shell 里直接执行 `pi -e $IB`（同时装有用户级那份），看启动时是否只出现上面那一次提示、`/skill:drive` 是否可用。
5. 完成后卸载用户级那份。

### 6.4 F7：连续新 batch

第二轮里，第一个 batch 之后的 batch 都在约 30 秒后把 child 停在 `needs_human`，原因是 `batch_worktree_failed … no recorded Lane binding`。现在 runtime 会先把 Lane 预留写进 batch record，再创建 worktree 和分支。

1. 6.1 完成后，不清理 Lane，接着依次执行 `routine probe-f7a f7a`、`routine probe-f7b f7b`，各跑一次 drive。
2. 每次 drive 期间另开一个 shell，在第一个 Executor tab 出现之前与之后各执行一次 `jq '.children[] | {task_id, state, lane, lane_reservation}' ~/imm-probe/L/.imm/state/batches/<batch_id>.json`（`<batch_id>` 取最新的那个文件）。
3. 期望：两次 batch 都进入 `enrolled` 并结算；出现 tab 之前可能看到 `lane_reservation`（`lane: null`），绑定之后 `lane_reservation` 消失、`lane` 有值；任何时候都没有 `batch_worktree_failed`。
4. 若某次仍停在 `needs_human`：保存 record 原文、`git worktree list --porcelain`、`git for-each-ref refs/heads/imm-lane`，以及 Parent 会话里那次 `start_unattended_batch` 的完整返回，**这就是定位依据**。

## 7. R4：Review、verifier、advisory 走会话（仓库 L）

Review 走**活跃的 user lane profile**：在 `~/.config/immune-brain/config.json` 里让 `lanes.active` 指向一个 profile，把 review 键放进该 profile 的 `lanes.profiles.<name>`（`<模型A>`、`<模型B>` 为两个不同的、Claude Code 可用的模型 id）。也可以在请求里点名 profile 或直接给字段——两者都比项目层优先。不要写进 `.imm/config.json`：活跃 user profile 设了 `review_host` 时项目层的同名字段不生效（F8，见 ADR 0037 与 `runtime/config/layered_config.ts:178-182`）。其余非 lane 键仍留在项目配置里不变。改完先看 `imm-kernel config --json`：`lanes.review_host` 应是新值，来源为 `user`。

```json
{ "contract": "immune_brain/user_config/v1",
  "lanes": { "active": "review-probe",
             "profiles": { "review-probe": { "review_host": "claude-code", "review_model": "<模型A>",
                                            "review_verifier_model": "<模型B>", "review_transport": "herdr",
                                            "advisory_transport": "herdr" } } } }
```

`.imm/config.json` 保留 `git_integration`、`initiative_carrier` 与 `review_verifier: "on"`，不要在那里写 `lanes.review_*`。

| 用例 | 步骤 | 期望 |
| --- | --- | --- |
| S4-b | 在 **Herdr 外**的终端启动 Claude Code Parent，`material probe-m0` 后执行 drive | QA 结算后得到 `review_preparation_failed`、`code: "review_transport_unavailable"`，带恢复动作；之后用 `/immune-brain:drive` 的停止操作结束该任务 |
| S4-a | 在 Herdr 内，`material probe-m1` 后执行 drive | `review_ready` 的 `review_command` 以 `…/bin/imm-session' 'run' '--provider' 'herdr'` 开头；Executor 执行后出现 tab `review probe-m1 [imm:…]`，能看到 reviewer 运行；命令返回 `{"ok":true,"exit_code":0}`，`submit_review` 正常结算 |
| S3-a/b | 若 Review 给出 rework（有 blocking finding） | `verification_ready` 带 `verification_command`（含 `'verify probe-m1'`）；运行中 `submit_verification` 得 `verification result pending`；运行完后出现 tab `verify probe-m1 [imm:…]`，`submit_verification` 返回 `rework` 或继续；`.imm/audit/probe-m1/` 中该轮的 verification facts 含 `verifier_actor: "cli-verifier:claude-code:…"`、`verifier_model: "<模型B>"`、`model_relation: "different"` |
| S3-c | 再跑一个 material 任务，在 verify tab 出现后立刻在该 tab 中按 Ctrl+C 中断 verifier | finding 全部保留；facts 的 `failure` 为 `dispatch_failed`；Review 结论不被削弱 |
| S3-d | 把 `review_transport` 改为 `process` 并提交，再跑一个 material 任务 | `verification_command` 为 `sh …/verify.sh`，在 Parent 的 shell 里运行，其余结论同 S3-b |
| S2-a | 在 Claude Code Parent 中明确要求：“对 src/clamp.ts 做一次 advisory-reviewer 只读评审” | Parent 按 `subagent-dispatch-protocol.md`“Advisory Child In A Supervised Session”：`imm-session create` → `await` → `read --source scrollback --lines 2000 --extract advisory`，`result` 非空并被采用；之后 `imm-session stop` 关闭该会话 |
| S2-b | 再要求一次 advisory 评审，advisory tab 出现后在其中按 Esc / Ctrl+C 打断 | `read --extract advisory` 返回 `result: null`；Parent 视为 `result_untrusted` 丢弃，不自动重试 |
| S2-c | S2-a 结束前，执行 `$IMM read <advisory handle> --provider herdr --source scrollback --lines 2000 > $EV/S2c-raw.json` | 保存原始输出。若 S2-a 的 `result` 为 `null` 而原文里确有标记块，说明 Claude TUI 的渲染让抽取失败，**这份原文就是修复依据** |

**关于 S3 的触发**：S3 需要真实 reviewer 给出 rework，无法强制。最多试 3 个 material 任务（`probe-m1`、`probe-m2`、`probe-m3`）；都没出现 rework 时记“未触发”，S3 的传输由自动化测试覆盖，可改为在 S2-a 里对同一文件做评审作为旁证。

## 8. R5：herdr-core（可选）

只在打算启用 herdr-core 时做。第三轮在 **Herdr 内**（`imm-probe` workspace 的 pane）执行，这样才能验证观看 tab；B14 的最后一步换到 Herdr 外。设置隔离环境：

```sh
export HC_SESSION=imm-probe
export XDG_STATE_HOME=~/imm-probe/xdg/state XDG_CONFIG_HOME=~/imm-probe/xdg/config XDG_RUNTIME_DIR=~/imm-probe/xdg/run
mkdir -p "$XDG_STATE_HOME" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
```

| 用例 | 步骤 | 期望 |
| --- | --- | --- |
| B1 准入 | `rec B1 $IMM probe --provider herdr-core`；`hc schema --json \| jq .info` | `ok: true`；version ≥ 0.1.19；description 含 `Protocol generation 1` |
| B2 正常一轮 | 同 A2，`--provider herdr-core`；另存 `hc get <address> --json` | `hc ls` 多一个终端，标签 `imm-session=<token>`；create 返回 `entry_submitted: true` 与 `viewer: {"opened": true}`；`imm-probe` 里多一个**不抢焦点**的 tab，名为 `probe-a2 (hc <address>)`，里面是 `hc attach` 显示的 Host 界面，能看到 entry 被执行；observe 的 provenance 为 `reported`；stop 后终端为 `finished` |
| B3 workspace trust | 同 A3 | Claude：30 秒后返回 `entry_submitted: false`、`state: "unknown"`，`attention` 含 `in its viewer tab`；观看 tab 里能直接看到 trust 对话框，并可在其中回答；回答后 `--resume` 提交 entry（G3 对 Claude 记失败，属已知）。Pi / Antigravity：首报 `blocked` 则通过 |
| B13 观看 tab 的去留 | 对 B2 的会话：① 手动关掉观看 tab，再 `rec B13 $IMM attach "$HD" --provider herdr-core`；② 在新观看 tab 里按 `hc attach` 的分离键（见 `hc attach --help`）分离；③ 再 attach 一次后执行 `$IMM stop "$HD" --provider herdr-core` | ① 返回 `ok: true`，又出现一个不抢焦点的观看 tab，会话不受影响；② 分离后记下 tab 是否自动关闭（`&& exit`）以及 `hc attach` 的退出码（`echo $?` 需在关闭前看到，否则记“已关闭”）；③ 会话结束后观看 tab 是否自动关闭。三项都只记录现象，不判失败 |
| B14 归属与 Herdr 外 | 对 B9 的自建终端执行 `$IMM attach herdr-core:<address>/guessed --provider herdr-core`；对 Herdr 会话执行 `$IMM attach <A2 的 handle> --provider herdr`；到 **Herdr 外**的终端（同样设置隔离环境）跑一次 B2 的 create | 前者 `not_owned`，不开 tab；中者 `provider_unavailable`；Herdr 外的 create 结果里**没有** `viewer` 字段，也不开任何 tab |
| B4 权限框 | 同 A4，`--provider herdr-core`；另存 `hc get --json` 的 `status` | `blocked`，`status` 含 `kind: "permission"`，≤ 5 秒 |
| B5 登录框 | 同 A5 | `blocked`；或返回 `entry_submitted: false` 加 `attention`（该 Host 不报登录状态，在 core 上不准入） |
| B6 首次上报 | B2 期间每 0.2 秒 `hc get <address> --json \| jq .status` | 首报为 `idle`，记录距 `hc run` 的秒数 |
| B7 `done` 收指令 | 同 A6 | `done` 时 send 成功（adapter 不带 `--if`），`idle` 时带 `--if idle` |
| B8 版本门 | 建一个只打印 `claude 2.1.100` 的脚本 `claude`，放到 PATH 最前，执行 create | `provider_unavailable`；`hc ls` 无新终端 |
| B9 归属 | `hc run --bg --json -- sh` 自建终端，拼 `herdr-core:<address>/guessed` 执行 observe 与 stop | 都 `not_owned`；终端仍在 |
| B10 无上报 | 对 Pi 加 `--env PI_PROGRAM_STATUS=0`，或对 Antigravity 加 `--env AGY_CLI_OSC7501=off` | 30 秒后 `entry_submitted: false`、`unknown`、带 `attention`；entry 未发送；终端保留 |
| B11 长等待 | 让一个会话工作超过 3 分钟（entry：“Run `sleep 200` with your shell tool, then reply DONE.”，批准权限），执行不带 `--timeout-ms` 的 await | 跨过 core 的 180 秒周期返回后继续等，直到真正变化才返回 |
| B12 已结束终端的 resume | B2 会话 stop 之后执行 `create --resume` | `state_refused`，原因含 `create a new session`；`hc ls` 无新终端 |
| S1-d | Loop 契约尚未启用 herdr-core，改为用一份手写的 batch record 直接验证 `close` 的核对：<br>`R=$(mktemp -d); mkdir -p $R/.imm/state/batches`<br>先不写 record，执行 `$IMM close <B2 的新 handle> --provider herdr-core --batch probe-x --task probe-x --recorded-at 2020-01-01T00:00:00.000Z --root $R`；<br>再 `echo '{"batch_id":"probe-x","session_closes":[{"task_id":"probe-x","at":"2020-01-01T00:00:00.000Z"}]}' > $R/.imm/state/batches/probe-x.json`，重复同一命令 | 第一次 `close_unproven`，终端仍在；第二次终端先被 kill 再被 rm，`hc ls --all` 中不再出现，它的观看 tab 随之结束 |

收尾：`hc ls --all` 列出的测试终端逐个 `hc kill`、`hc rm`，最后 `HC_SESSION=imm-probe hc server stop`（只停隔离的 core）。

## 9. 清理

- 关闭 `imm-probe` workspace 中的测试 tab 与 workspace。
- `cd ~/imm-probe/L && git worktree list`，按需 `git worktree remove` 与删除 `imm-lane/` 分支（Lane 本就保留给你删除）。
- 卸载 C-1 用到的用户级 Pi package，恢复 Pi / Antigravity 的权限设置。
- 保留 `~/imm-probe/evidence/`，其余可删除。

## 10. 交回的内容

打包 `~/imm-probe/evidence/`（`versions.txt`、`timeline.log`、各 `*.json`、`results.md`、Parent 会话记录、`S2c-raw.json`；第三轮另含 6.4 的 record 快照、A5 与 B3 的截图），以及每轮遇到的意外现象的文字说明。收到后会：把结果写进 `issue-426-herdr-provider-probe.md`，逐条标明此前“仅源码核对”的结论被证实或推翻；修复发现的问题；按结果更新 `supervised-session-port.md` 的准入矩阵。
