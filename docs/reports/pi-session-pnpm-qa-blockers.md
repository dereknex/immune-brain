# 两个 Pi session 阻塞分析

## 范围与证据

只分析用户指定的两个 session、它们对应的三个 TaskRecord，以及相关 delivery workspace 源码。未实施修复、未调用 authority 工具、未改动两个业务仓库。当前 immune-brain 源码 revision：`d5841732ba6acc00fec58fb732f3b9f030789ed1`，Git 安装副本 package version 为 `3.6.9`。

- [refine session](/Users/derek/.pi/agent/sessions/--Users-derek-workspaces-refine--/2026-09-15T01-35-50-332Z_01a0a2b4-c23c-73ee-b33b-226cda712722.jsonl)：共 3410 行，重点核对末段 3100–3410；最后消息 2026-09-17T01:01:29.284Z。
- [nextty session](/Users/derek/.pi/agent/sessions/--Users-derek-workspaces-nextty.dev--/2026-09-15T14-50-20-774Z_01a0a58c-26e5-73e0-866e-f14905013cdc.jsonl)：共 1230 行，重点核对 950–1230；最后消息 2026-09-17T00:53:36.125Z。
- 当前状态以两个仓库 `.imm/state/kernel.sqlite` 的只读查询为准：`runs.record_json`、`terminal_proof_json`、`workspace.current_run_id`。

这是明确指定的阻塞样本，不是最近十个终态任务的统计；包含一个 active 和两个 stopped 任务。未全面审计两个长 session 的早期实现，也未重跑业务测试。日志中最后的 assistant 消息均正常 stop，未见末尾悬挂的 tool call；不能据此判断宿主进程健康，但当前证据支持工作流停滞，而非模型死循环。

## 当前状态

| Session / task | 当前 durable 状态 | QA / Review 证据 | 恢复方式 |
|---|---|---|---|
| refine / heuristic-summary-prose-shape | active，artifact active，workspace owner 为 run-4ef7f3d5-75b9-40e0-8a31-c4f75bac81e2 | 2 个 open execution finding，0 attestations | 修依赖环境后继续原任务 |
| nextty / feedback-custom-domain-flag-gates | stopped，frozen | 3 个 resolved execution finding，0 attestations | 新建补验 task，保留旧终态 |
| nextty / feedback-custom-domain-production-bindings | stopped，frozen | 0 finding，0 attestations；此次未执行 Kernel QA | 新建补验 task，保留旧终态 |

nextty 当前 workspace.current_run_id 为 null。两个 stopped record 的 `JSON.stringify(record,null,2)+"\n"` 等价格式 SHA-256 均匹配 tombstone 的 final_record_hash，terminal_event_id 均出现在 record 内。终态为 stopped，不是 done；哈希校验只证明记录内部一致性。

## 主要根因：隔离 QA 的依赖准备只支持 Bun

[delivery_workspace.ts](/Users/derek/workspaces/immune-brain/plugins/immune-brain/runtime/assurance/delivery_workspace.ts:83) 的 prepareDependencies 只查找 bun.lock / bun.lockb，找不到直接 return。materializeDeliveryWorkspace 从冻结 Git tree 创建独立目录，然后调用它；不会继承宿主 node_modules。

当前两个业务仓库都只有 pnpm-lock.yaml；refine 声明 packageManager=pnpm@10.32.1，nextty 根 package.json 没有 packageManager 声明。两个项目的 pnpm 依赖因此完全跳过安装，随后才执行 Vitest 验收。

证据链：

- refine 行 3357：QA operation `edc9631b-1497-434c-8c1a-8aa47e7f1ae1` 两个 descriptor 均 exit 1，stderr 3188 / 3187B；行 3385 的干净目录复现出现 ERR_MODULE_NOT_FOUND；行 3401 确认只跟踪 pnpm-lock.yaml。当前 open finding 为 `qa-AC-1-prose-shape-97bfcdc3-3d19ad`、`qa-AC-2-no-regression-97bfcdc3-68f5b4`。
- nextty 行 1107：QA operation `77cdb2c0-dbe4-46d4-a90e-d6a9feb6d0ad` 三个 descriptor 均 exit 127，stderr 223 / 203 / 242B；行 1116、1118 的宿主同类命令可运行，行 1146 确认没有 Bun lockfile。持久化证据不含 stderr 原文，因此具体缺失命令不能仅凭 exit 127 断言；但源码与项目锁文件已直接证明依赖准备被跳过。
- nextty S2 是沿用 S1 的环境判断后停止，不能计为另一次实测 QA 失败。

反例与边界：宿主测试通过不能证明快照可运行；原生 Bun 项目走现有安装分支，不受“pnpm 被跳过”这一特定问题影响。refine 曾在线预热 Bun cache，但没有把 Bun lockfile 带进冻结树，仍然不会触发当前安装分支。

## 次要摩擦：scope 修订与终态处理

refine 行 3289、3295 的 breaking revision 因现有 authorization envelope 不含 `tests/agents/src/summary-generator-agent.test.ts` 被拒；行 3305 因修改 goal 被拒，行 3309 已成功修订。之后行 3334 报 sidecar 超出 envelope，行 3342 报 sidecar missing，行 3346 成功修订至 revision 3。后续 QA 已实际执行，因此这些是已跨过的历史障碍，不是当前主阻塞；也说明不能凭“加一个 bun.lock”就认定恢复只需安装依赖，scope 与授权仍须核实。

nextty 用户在行 1153 要求使用宿主等价证据推进，行 1180 选择 C，行 1182 的 native stop 成功；S2 行 1217 也 native stop 成功。应尊重这些真实终止决定，但不能把 stop 当作 QA pass 或通用成功路径。resolved finding 也没有产生 attestations。

原会话部分建议需更正：

- TaskRecord v4 与 TaskIntent contract v1 属于不同版本维度。单纯将 TaskIntent 改成 v4 不会修复依赖。
- 存储迁移与开始隔离 QA 的时间相邻，不足以证明“SQLite 迁移改变了 QA 语义”；本次确认的是 runtime 的 materialization 行为。
- 给 pnpm 项目增加第二份 Bun lockfile会带来两套依赖解析，不推荐作为默认永久修复。
- “支持 pnpm 约 15 行”低估了 workspace、版本固定、离线缓存、安装脚本策略及共享 store 隔离验证。
- stopped 任务不能直接续跑为 done。补验应建立新任务，绑定当前交付内容；不能假定旧 descriptor 永远无需复核。

## 推荐方案

1. 优先修 immune-brain 的 prepareDependencies，直接支持项目原生 pnpm lockfile。冻结树内选择包管理器；明确包管理器版本与冲突锁文件策略；离线、frozen-lockfile、禁安装脚本执行；不借用宿主 node_modules。缺少可执行文件、离线缓存或支持能力时，在准备阶段给出明确错误，不等到 Vitest 报 exit 127。
2. 为 pnpm workspace 验证链接位置和 store 隔离。现有递归 chmod 不应意外改变共享 pnpm store 的 inode 权限。包缓存不足在 QA 之外显式准备，不让 QA 静默联网。Bun 仍可作为 verification runner，安装依赖使用 pnpm，两者职责可以分开。
3. 最小验证覆盖：只有 pnpm-lock.yaml 的干净快照可运行一个依赖 Vitest 的测试；workspace 本地包可解析；缓存缺失明确失败；原 Bun 路径仍通过；不改变锁文件、宿主 node_modules 或共享 store 权限。实施时沿现有 assurance 测试定位扩展，不另建调度框架。
4. 构建并验证发布包，更新真正被 Pi 加载的插件后重启会话。不能只修改工作区源码就宣称已修复宿主。nextty 日志行 966 曾从 npm 安装路径加载失败，重启后行 982 报 3.6.9；当前可读 Git 安装副本亦为 3.6.9，本次未确认两个存活进程正在加载的精确路径。
5. refine：在原项目会话检查 owner、当前 TaskIntent 和 staged delivery；确认隔离依赖准备成功后，按 Kernel 流程处理两个 execution finding，再运行新的 QA。保留当前任务，不清空状态库、不重做 enrollment。
6. nextty：S1/S2 保留 stopped 历史；若要求完整保证，为现有已提交实现新建补验 TaskIntent，运行 QA 与 required Review。S3–S5 继续原规划，但真实资源阶段仍受凭据、webhook secret 与测试 host 前置约束；这些信息来自原会话，本次未读取秘密或验证远端资源。

唯一优先改进是原生 pnpm 依赖准备。后续样本限定为 refine 原任务的下一次 QA，以及 nextty S1/S2 补验任务：记录准备成功/失败、真实 QA 结果和终态；不把减少 finding 数量当成成功指标。

## 可复核方法

JSONL 行号按文件原始行计数，可用 Python enumerate(read_text().splitlines(),1) 取上述证据；只读取 message.role、toolName、content 中对应工具结果。三个任务的计数可通过 SQLite URI `file:<absolute path>?mode=ro`，使用参数化查询 `SELECT record_json,terminal_proof_json FROM runs WHERE task_id=?` 复核。finding 按 source/status 计数，attestations 按数组长度计数。终态哈希使用解析后保留键顺序、双空格缩进、Unicode 原文与末尾换行的 SHA-256；需另核对 task_id、terminal_lifecycle 与 terminal_event_id。
