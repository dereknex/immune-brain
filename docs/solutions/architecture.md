---
title: Architecture Hub
reusability: high
key_files:
  - CONTEXT.md
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - plugins/immune-brain/runtime/imm_core.ts
  - plugins/immune-brain/runtime/state_ledger.ts
  - tests/imm-follow-up-runtime.test.ts
  - plugins/immune-brain/bin/imm-plan
  - plugins/immune-brain/bin/imm-work
  - plugins/immune-brain/skills/registry.yaml
  - plugins/immune-brain/tests/skill-registry-consistency.test.ts
  - tests/host-runtime-cutover.test.ts
  - tests/python-reference-boundary.test.ts
  - scripts/detect-stale-refs.ts
  - scripts/fix-broken-links.ts
  - docs/specs/
  - plugins/immune-brain/
---

> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Architecture Hub

This hub collects reusable architectural patterns for the Immune-Brain system, focusing on modularity, role boundaries, and system-wide reasoning.

Historical note: older entries below may cite retired Python or MCP runtime surfaces as source evidence. The current runtime truth is the plugin-local Bun + TypeScript CLI runtime in `plugins/immune-brain/runtime/immune_brain_runtime.ts`, reached through `plugins/immune-brain/bin/imm-*` wrappers and host-native plugin adapters.

## Pattern: Host-Native Plugin Distribution and Plugin-Local Runtime

Superseded current-truth pattern: this entry predates the CLI-only cutover. Reuse its packaging lesson only; do not treat its Python or MCP paths as active runtime entrypoints.

**领域**: Distribution / Packaging / Runtime Portability
**描述**: 当系统从单一全局安装器转向多宿主支持（Codex, Claude Code, Cursor, OpenCode）时，不再依赖全局环境的 shell wrappers 或 managed-copy 安装器。将技能和运行时工具的“真源”移入宿主无关的插件包内，使用宿主原生的 manifest（Codex `plugin.json`, MCP `.mcp.json`）和插件内的 `bin` 包装器将执行路由到统一的内部运行时适配器。

**reusability**: high
**next_reuse_scenarios**: [`支持新的 IDE 或代理宿主`, `减少对全局环境 PATH 的依赖`, `实现跨平台的插件安装与更新`, `统一个性化 runtime 与标准化 MCP 接口`]

### 场景
- 需要同时支持 Codex (managed install), Claude Code (bin wrappers), Cursor (MCP), 以及 OpenCode 等多宿主。
- 需要支持新的 Agent 宿主（如 OpenCode），且希望避免引入该宿主特有的前端/构建依赖（如 Bun, TypeScript 编译、JS 插件代码），防止技术依赖泛滥。
- `scripts/install-local.sh` 这种基于文件复制的安装逻辑难以处理不同宿主的生命周期。
- 全局 `imm-*` 命令在没有正确配置 PATH 的环境下失效。

### 方案模板
1. **插件包化**: 在 `plugins/` 目录下建立宿主无关的插件包（如 `plugins/immune-brain/`），包含所有 `skills/`、`.imm/` 和运行时脚本。
2. **统一运行时适配器**: 实现 `immune_brain_runtime.py`，作为所有宿主交互的单一入口，处理状态加载、激活、执行 and 自愈。
3. **原生 Manifest 与标准进程协议**:
   - **Codex**: `plugin.json` 指向技能目录。
   - **MCP**: `.mcp.json` 将 `immune_brain_runtime.py` 的子命令映射为 MCP 工具，供 Cursor, Claude Code, 以及 OpenCode 共享。
4. **宿主无关的 MCP 适配**: 在 `.mcp.json` 引导脚本中追加对新宿主（如 OpenCode）的插件缓存路径（如 `.opencode/plugins/cache/`）的扫描，实现免配置自适应路径解析。
5. **薄包装 (Thin Wrappers)**: 为 Claude Code 提供 `bin/` 目录下的 bash shim，将全局命令透明路由到插件内部的运行时适配器。
6. **发布解耦**: 更新 `sync-to-public.sh` 以插件包为核心构建产物，排除开发期的冗余文件（如 `.imm/memory/`）。

### Evidence
- [plugins/immune-brain/.codex-plugin/plugin.json](plugins/immune-brain/.codex-plugin/plugin.json), `plugins/immune-brain/.mcp.json` 实现了多宿主配置。
- `plugins/immune-brain/scripts/immune_brain_runtime.py` 作为统一适配器。
- [plugins/immune-brain/bin/](plugins/immune-brain/bin/) 提供了 Claude 兼容的 shim。
- [scripts/sync-to-public.sh](scripts/sync-to-public.sh) 完成了发布逻辑切换。
- 已删除 `scripts/install-local.sh` 和 `scripts/imm-cli-launcher`。

---
*沉淀日期: 2026-06-27 | 来源: OpenCode MCP Integration Plan U1*

## Pattern: MCP-First Runtime Entry With Host Authorization Gate

Superseded current-truth pattern: this entry is historical after the CLI-only runtime cutover. Treat MCP paths here as source-only reference evidence, not active runtime guidance.

**领域**: Distribution / MCP Runtime / Subagent Authorization
**描述**: 当 Codex、Cursor、Claude Code 都需要同一套 workflow runtime 时，不要让 host 依赖 PATH 中的旧 `bin/imm-*` wrapper，也不要把 subagent 自动触发和真实 spawn 授权混成一个开关。更稳的做法是把 plugin MCP tool 作为主入口，用结构化 activation plan 判断 eligibility，再由 host 单独判断当前用户、session 或项目说明是否足以授权真实 subagent dispatch。

**reusability**: high
**next_reuse_scenarios**: [`新增 host 需要复用同一 runtime`, `旧 PATH wrapper 与 plugin runtime 可能漂移`, `subagent auto 策略需要减少确认但不能绕过 host tool policy`, `MCP server 需要支持 marketplace cache 安装而不是只支持 repo-local plugin`]

### 场景

- plugin package 内已有 `.mcp.json` 和 `dist/immune_brain_runtime.py`，但某些 host 文档仍把 `bin/imm-*` 或旧 managed-copy wrapper 当主路径。
- `~/.immune-brain/config.toml` 能表达 `auto|explicit_only|disabled`，但这些配置只能说明“应该尝试”，不能替 host 授权调用 Codex `spawn_agent`、Cursor `Task` 或 Claude Code subagents。
- Cursor / Codex / Claude 的 plugin cache layout 不同；只搜索一种 cache 会让非 repo-local 安装无法启动 MCP runtime。

### 方案模板

1. **MCP 作为 host 主入口**: 在 `.mcp.json` 暴露 workflow tool 和 `imm_activation_plan`；`bin/imm-*` 只保留 manual/debug 或无 MCP host fallback。
2. **activation plan 只负责 eligibility**: `imm_activation_plan` 接收 `changed_paths`、`task_summary`、`host`、`activation_mode`、`activation_overrides` 等结构化输入，返回候选 lens、model tier 与 `solo_fallback_reason`。
3. **authorization gate 后置**: 只有 activation plan 返回 candidates 后，host 才解析当前用户消息、session-level 授权、或 `AGENTS.md` standing authorization。项目说明只能在 host 接受 project instructions 作为授权来源时生效。
4. **稳定 fallback reason**: 当 trigger 和配置都允许 dispatch、但 host policy 仍要求显式用户授权时，记录 `host_authorization_required`，不要伪装成 `trigger_not_hit`、`explicit_required` 或 `unavailable_environment`。
5. **cache layout 回归测试**: `.mcp.json` bootstrap 同时覆盖 repo-local plugin、Claude cache、Codex cache、Cursor cache；用 fake HOME smoke test 验证没有 project-local plugin 时也能启动。

### Evidence

- `plugins/immune-brain/dist/immune_brain_runtime.py` 新增 `imm_activation_plan` MCP tool，并把结构化参数映射到 activation planner CLI。
- `plugins/immune-brain/.mcp.json` 的 bootstrap 搜索 repo-local plugin、Claude cache、Codex cache 和 Cursor cache。
- [docs/reference/automatic-subagent-activation-policy.md](docs/reference/automatic-subagent-activation-policy.md) 和 [docs/reference/subagent-dispatch-protocol.md](docs/reference/subagent-dispatch-protocol.md) 明确区分 eligibility 与 host authorization，并定义 `host_authorization_required`。
- [plugins/immune-brain/skills/imm-init/templates/AGENTS.md](plugins/immune-brain/skills/imm-init/templates/AGENTS.md) 提供 standing authorization 文案，同时声明不覆盖 host tool policy。
- `tests/test_immune_brain_mcp_runtime.py` 覆盖 repo cwd、Claude cache 和 Cursor cache 的 MCP bootstrap；`tests/test_skill_contracts.py` 覆盖 MCP tool 暴露、plugin-only activation plan、authorization contract wording。

### 约束与建议

- 不要让 `AGENTS.md` 静默绕过 host 的显式 subagent 要求；它只能作为可被 host 接受的授权来源之一。
- 不要把旧 PATH wrapper 当主集成方式；wrapper 可留作人工调试和无 MCP host 的兼容路径。
- 不要把 MCP cache 搜索写死到单一 host；每新增一个 host 安装形态，都要增加 fake HOME smoke test。

---
*沉淀日期: 2026-05-23 | 来源: mcp-first subagent activation U1-U4 + Cursor cache follow-up*

## Pattern: Lens-Based Unified Reviewer

**领域**: Skill System / Specialized Review / Subagent Dispatch
**描述**: 当多个咨询类审阅者（如安全、API、数据完整性）共享相同的行为模式（读取委派包、 advisory-only 边界、无工具运行）时，不要为每个领域创建独立的“浅层”技能目录。更稳的做法是实现一个统一的 `imm-advisory-reviewer` 技能，通过 **委派包 (Delegation Packet)** 中的 `lens` 字段动态加载领域逻辑。

**reusability**: high
**next_reuse_scenarios**: [`增加新的咨询类审阅维度（如性能、可访问性）`, `减少技能目录膨胀`, `统一子代理分发协议的实现`, `简化激活计划的逻辑`]

### 场景
- `security-reviewer`、`api-contract-reviewer` 等技能在 `SKILL.md` 的核心逻辑上高度重复。
- 增加一个新的审阅领域需要复制大量样板文件。
- 子代理分发宿主（如 `imm-code-review`）需要硬编码支持的所有子技能列表。

### 方案模板
1. **定义统一入口**: 创建 `imm-advisory-reviewer` 技能，作为所有咨询类审阅的通用宿主。
2. **参数化透镜 (Lens)**: 在 `Required inputs` 中增加 `lens` 字段。激活计划 (Activation Plan) 根据触发规则决定具体透镜值。
3. **元数据驱动**: 将领域特定的触发器（关键字、路径）保留在 `subagent-trigger-catalog.yaml` 中，但将 `output_artifact` 和 `skill_id` 统一或映射到该通用技能。

## Pattern: Machine-Readable Skill Registry

**领域**: Orchestration / System Reasoning / Role Boundaries
**描述**: 当技能之间的关系（宿主、子代理、移交路径）仅存在于自然语言文档或代码硬编码中时，系统难以对自身的图谱进行自动化推理。更稳的做法是维护一个机器可读的 `skills/registry.yaml`，声明每个技能的角色、产生工件以及合法的后续操作（Next Action）。

**reusability**: high
**next_reuse_scenarios**: [`自动化验证 Next Action 是否合法`, `构建可视化的技能依赖图`, `动态路由生成的提示词参考`, `在不同 runtime 间同步技能能力`]

### 场景
- `imm-activation-plan` 需要硬编码 `CHILD_ORDER_BY_HOST`。
- Planner 规划 `Next Action` 时可能指定一个不存在或角色不匹配的技能。
- 新加入的技能难以被现有编排逻辑自动识别。

### 方案模板
1. **中心化定义**: 在 `skills/` 根目录下维护 `registry.yaml`。
2. **声明式元数据**: 为每个技能定义 `name`、`role` (brainstorm, plan, execute, etc.)、`output_artifacts` 和 `next_actions`。
3. **验证器集成**: 在 `test_skill_contracts.py` 中增加对注册表一致性的检查。

## Pattern: Decoupled Workflow State Machine

**领域**: Workflow Runtime / State Ledger / Maintainability
**描述**: 当状态转换规则与业务逻辑（如迁移、推导、文件操作）混在一起时，状态机难以测试且容易产生非法转换。更稳的做法是将核心转换逻辑抽取为独立的 `LedgerStateMachine`，仅负责状态合法性判定和转换执行，而将副作用（Persistence）交给外层。

**reusability**: high
**next_reuse_scenarios**: [`实现步骤的并行执行`, `支持嵌套子计划的状态追踪`, `增加更复杂的状态转换守卫`, `重构大型状态管理脚本`]

### 方案模板
1. **封装状态机**: 在 `.imm/state_machine.py` 中定义 `LedgerStateMachine` 类，持有 `STEP_STATES` 和 `VALID_TRANSITIONS` 常量。
2. **纯函数/无状态优先**: 转换逻辑应接受当前状态并返回新状态，或者在受控的实例中操作，避免直接在全局变量中散布修改。
3. **分层职责**: 运行时模块（如 `current_iteration_state.py`）仅作为状态机的调用者，负责 I/O 和 v1/v2 兼容性适配。
## Pattern: Internal Package Migration and Dependency Hygiene

**领域**: Workflow Runtime / Maintainability / Architecture Deepening
**描述**: 当项目脚本依赖 `importlib.util` 动态加载同级文件或存在反向依赖（core 依赖 root）时，会导致代码静态分析失效，增加重构风险。更稳妥的做法是将内部核心逻辑彻底重构为正式的 Python 包（例如 `.imm/imm_core/`），并确保所有核心逻辑（包括路由、遥测、加载器）都位于包内，根目录脚本仅作为薄 CLI 包装器（thin wrappers），从而消除反向和动态依赖。

**reusability**: high
**next_reuse_scenarios**: [`整理散落的内部脚本`, `提升大型工具库的可测试性`, `消除由于动态导入导致的递归或反向依赖`, `统一 CLI 入口与核心实现的分离`]

### 场景
- 目录下大量使用 `importlib.util.spec_from_file_location` 互相加载。
- Core 模块（如遥测、状态解析）需要动态加载根目录下的脚本，导致静态工具无法追踪依赖。
- 存在大量垫片（shims）文件，仅仅是重导出包内的函数，增加了维护成本。

### 方案模板
1. **建立包结构**: 创建专属包目录并放入核心模块（如 `.imm/imm_core/`）。
2. **中心化核心逻辑**: 将所有不具备 CLI 交互性质的逻辑（解析、状态机、路由算法）移入包内。
3. **消除反向依赖**: 修改包内模块，通过显式的相对导入或包内导入来替代 `importlib.util` 动态加载根目录脚本。
4. **清理残余门面**: 当包内路径已稳定且测试已适配后，移除根目录下冗余的垫片模块（如 `state_machine.py`），迫使外部直接引用包。
5. **归口关键路由**: 将核心路由逻辑（如 `activation_plan.py`）移入包，根目录保留同名脚本作为简单调用入口。

### Evidence
- 移除了 `.imm/imm_core/` 对根目录 `.imm/imm-telemetry.py` 和 `.imm/imm-plan.py` 的动态加载依赖。
- 删除了遗留的 `.imm/current_iteration_state.py` 和 `.imm/state_machine.py` 垫片文件。
- 将 `activation_plan.py` 的核心实现迁移至 `.imm/imm_core/activation_plan.py`，原位置保留 CLI 包装器。
- 验证包含 `rg "importlib\.util"` 在包内无非预期匹配，以及全量测试通过。

---
*沉淀日期: 2026-05-17 | 来源: Architecture Deepening Wave 2*

**领域**: Skill System / Architecture Migration / Contract Truth
**描述**: 当一个 runtime surface 被统一宿主或 lens 取代时，删除目录和 registry entry 只是迁移的一部分。必须同步所有当前事实面：health/heal 列表、contract tests、specs、reference docs，以及会被 future agents 当作 source truth 的文案。`.imm/memory/current_iteration.json` 这类执行证据可以保留历史路径，但不能再被解释为当前 contract。

**reusability**: high
**next_reuse_scenarios**: [`删除或合并 skill surface`, `把 standalone reviewer 迁移到 lens-based host`, `架构审计后的文档事实清理`, `防止 registry 与 specs drift`]

### 场景
- 旧的 standalone reviewer skill 已经被 `imm-advisory-reviewer` lens 取代，但 specs/reference docs 仍把旧路径描述为当前入口。
- 代码和测试已经删除旧 registry entry，但 heal/contract surfaces 还会要求旧文件存在。
- v2 state ledger 已经按 `steps` 推导闭环状态，但旧的 `completed_steps` 字段仍可能在迁移数据中残留。

### 方案模板
1. **先同步 runtime truth**: 同一轮移除 skill 目录、`skills/registry.yaml` entry、heal/required-file 列表，以及相关 contract tests。
2. **再同步 current-facing docs**: specs/reference docs 中不要写“旧入口仍兼容”或“已落地旧 reviewer”等当前事实；需要保留历史时明确标为 superseded 或 historical evidence。
3. **用 grep 锁住负面事实**: 对删除路径和过期措辞增加 targeted grep 验证，避免旧 contract truth 重新漂回文档。
4. **区分证据与契约**: `.imm/memory/current_iteration.json` 可保留被改过的历史路径；当前契约必须来自 registry、specs、reference docs 和 tests。
5. **状态迁移只在边界兼容**: v1/v2 兼容逻辑应限制在 plan-valid heal 或 migration 边界；运行时推导 API 应以 v2 ledger 为准，忽略 stale legacy fields。

### Evidence
- 删除 legacy reviewer SKILL surfaces 后，`skills/registry.yaml`、`.imm/imm-heal.py`、`tests/test_skill_contracts.py` 与相关 specs/reference docs 均改为 `imm-advisory-reviewer` lens truth。
- `current_iteration_state.derive_completed_steps` 对 v2 状态只从 `steps` 推导 closed steps，忽略 stale `completed_steps`。
- 验证包含 full unit suite、删除路径 grep、过期文案 grep，以及 stale v2 completion 推导检查。
- Architecture Map update: none needed; root `CONTEXT.md` already points future agents to `skills/registry.yaml`, `.imm/imm_core/`, `docs/specs/`, `docs/solutions/`, and `.imm/memory/MEMORY.md`.

---
*沉淀日期: 2026-05-16 | 来源: Architecture Deepening Wave 1*

## Pattern: Durable Evidence Persistence Layer

**领域**: Workflow Runtime / State Ledger / Subagent Coordination
**描述**: 当 subagents (子代理) 需要返回结构化证据并让其在后续步骤中持久存在时，不要只靠日志输出或临时文件。更稳的做法是在 State Ledger (状态账本) 的每个步骤中引入 `child_evidence` 字段。该字段在步骤激活时初始化，并在 QA 闭合前持久化，允许后续步骤 (或 planner/compounder) 像读取本地执行证据一样读取子代理产出的结构化事实。

**reusability**: high
**next_reuse_scenarios**: [`subagent 产出需要被下一个步骤作为输入`, `planner 需要基于上一步子代理的发现进行重规划`, `compounder 自动提取子代理沉淀的 learnings`, `执行证据需要跨 session 保持结构化`]

### 方案模板
1. **Schema 支持**: 在 `.imm/memory/current_iteration.json` 的 `steps` 结构中增加 `child_evidence` 字段 (Schema v2)。
2. **执行期采集**: 宿主 (Host) 在 dispatch 子代理后，将其返回的 `output_artifact` 存入当前激活步骤的 `child_evidence`。
3. **持久化保障**: `LedgerStateMachine` 在 transition 或 closure 时必须保留该字段，且 `imm-plan.py` 在 sync 时应兼容无该字段的旧 Plan。
4. **验证契约**: 在 `test_current_iteration_state.py` 中测试 `child_evidence` 的 save/load/preserve 逻辑。

### Evidence
- `.imm/imm_core/current_iteration_state.py` 支持 Schema v2 `child_evidence` 字段及其迁移。
- `.imm/imm_core/state_machine.py` 在转换过程中保留 `child_evidence`。
- `tests/test_current_iteration_state.py` 验证了 persistence 契约。
- `python3 -m unittest tests.test_current_iteration_state` 通过。

---
*沉淀日期: 2026-05-17 | 来源: subagent evolution plan U1 验收*

## Pattern: Simplification via Dependency Elimination (File-Copy over Git-Filter-Repo)

**领域**: Build Pipeline / Public Release / Simplification
**描述**: 当同步脚本的输出不需要 git 历史时，不要引入 `git-filter-repo` 等重型外部依赖来提取路径历史。更稳的做法是使用纯 POSIX 文件级复制（`cp`），将白名单路径从源仓库复制到干净的目标目录，零 git 操作、零外部依赖。

**reusability**: high
**next_reuse_scenarios**: [`任何需要从内部仓库提取公开子集的场景`, `CI pipeline 中生成部署 artifact`, `替换复杂的 git-filter-repo 流水线`, `消除脚本的外部工具依赖`]

### 场景
- 需要从内部 monorepo 提取公开可安装内容（引擎 + skill + 文档 + 部署脚本）。
- 当前方案依赖 `git-filter-repo` 进行历史过滤，增加了安装负担和复杂度。
- 公开 artifact 不需要 git 历史——只需要文件树。

### 方案模板
1. **定义白名单**: 在脚本中声明 `KEEP_PATHS`（目录前缀和具体文件）和 `EXCLUDE_PATHS`（需排除的子路径）。
2. **文件级发现**: 用 `find` 遍历白名单目录，用 `printf` 列出所有文件。
3. **逐文件复制**: 遍历文件列表，对每个文件检查是否在白名单内且不在排除列表内，用 `cp` 复制到目标目录。
4. **模板覆盖**: 对需要脱敏的公开文档（README、CONTRIBUTING 等），从模板目录覆盖到目标。
5. **安全守卫**: 拒绝向源仓库内部写入；`--force` 仅当目标目录包含产物标记文件时允许删除。
6. **零 git 操作**: 输出为纯文件目录，不含 `.git`。不调用 `git clone`、`git init`、`git commit`。

### Evidence
- [scripts/sync-to-public.sh](scripts/sync-to-public.sh) 从 79 行 git-filter-repo 管道重写为 228 行纯 cp 脚本。
- 消除了对 `git-filter-repo` 的唯一外部依赖——现在仅需 `bash` + `cp`。
- `--dry-run`、`--output-dir`、`--force` 标志契约保持不变；`--branch`、`--include-worktree` 因与 git 耦合而移除。
- 验证通过：`--dry-run` 输出正确；端到端同步生成干净目录，无 `.git`、无 `upstreams/`、无 `.imm/memory/`；安全守卫（内部路径拒绝、标记文件检查）正常工作。
- 无 `CONTEXT.md` Architecture Map 更新需要。

---
*沉淀日期: 2026-05-18 | 来源: public-release file-copy sync plan U1 验收*

## Pattern: Execution-Bound Subagent Authority

**领域**: Agent workflow / Security / Subagent Runtime
**描述**: 当需要委派子代理执行文件修改任务 (如 fix test, lint) 时，不要给它全局写入权限，也不要只靠提示词约束。更稳的做法是在 `registry.yaml` 中定义 `active-step-bounded-executor` 权限类，并配合 `focus_delta` 明确写入边界。子代理仅在宿主明确授权的 `specific_changes` 路径内有写权限，且其产出必须通过宿主的 `child_evidence` 记录进账本。

**reusability**: high
**next_reuse_scenarios**: [`新增自动化修复类 subagent (如 linter-fixer, refactor-expert)`, `在有限边界内尝试 speculative code changes`, `加强子代理运行时的安全隔离`, `自动化验证子代理是否越权修改文件`]

### 方案模板
1. **权限分级**: 在 `skills/registry.yaml` 中为 subagent 增加 `authority_class: active-step-bounded-executor`。
2. **边界委派**: 宿主在 delegation packet 的 `focus_delta.specific_changes` 中列出允许修改的文件。
3. **协议闭环**: 子代理返回标准 `output_artifact`，宿主将其存入 `child_evidence`，QA 基于该证据判定是否闭合。
4. **Contract Guard**: 在 `test_skill_contracts.py` 中验证权限类与边界定义的合法性。

### Evidence
- [skills/test-fixer/SKILL.md](skills/test-fixer/SKILL.md) 实现了第一个 execution-bound subagent。
- [skills/registry.yaml](skills/registry.yaml) 注册了 `test-fixer` 及其权限类。
- `tests/test_skill_contracts.py` 增加了对 `active-step-bounded-executor` 契约的覆盖。
- Architecture Map update: none needed.

---
*沉淀日期: 2026-05-17 | 来源: subagent evolution plan U3 验收*

## Pattern: Thin CLI Shim for Fat Runtime Modules

**领域**: Workflow Runtime / Plan Validation / DRY
**描述**: 当根目录 CLI 脚本与 `imm_core` 内模块重复持有同一套正则、解析与验证逻辑时，不要继续双份维护。更稳的做法是：以 `activation_plan.py` 为模板，将根脚本收成 ~50 行薄 shim——仅保留 `sys.path` 引导、`from imm_core.<module> import *` 与 `main()` 委托——所有常量与业务逻辑只留在包内单一引擎。

**reusability**: high
**next_reuse_scenarios**: [`imm-plan.py 类重复 CLI 去重`, `新增 CLI 时默认 shim + imm_core 实现`, `消除 STEP_HEADER_RE 等双份常量`]

### 方案模板
1. **选定包内权威模块**（如 `plan_runtime.py`）作为唯一解析/验证引擎。
2. **根 CLI 只做**：路径引导、re-export、`build_parser()` + `validate_plan()` 委托、`main()` 退出码。
3. **删除 shim 侧重复常量**；回归测试仍通过 CLI 入口与包 API 两条路径。

### Evidence
- `.imm/imm-plan.py` 从 742 行减至 48 行，逻辑委托 `imm_core.plan_runtime`；模板对照 `.imm/activation_plan.py`（15 行级 shim）。
- `docs/plans/2026-05-19-002-feat-architecture-improvement-wave-3-plan.md` U001；`python3 -m unittest discover -s tests` 通过（迭代记录 365/366，1 条既有无关失败）。

---
*沉淀日期: 2026-05-19 | 来源: Architecture Improvement Wave 3 U001*

## Pattern: LedgerManager-Centric God Module Extraction

**领域**: State Ledger / Maintainability / Testability
**描述**: 当 `current_iteration_state.py` 同时承载 LedgerManager、v1→v2 迁移、自愈 heal、闭步脱水等多条无环职责时，不要继续在单文件内堆叠。更稳的做法是：保留 `LedgerManager` + 状态机调用为转换权威，将 heal / migration / dehydration 抽到独立模块，并通过**显式可注入回调**（`is_v2_fn`、`append_history_fn`、`load_normalized_plan_fn` 等）避免与 LedgerManager 形成循环导入。

**reusability**: high
**next_reuse_scenarios**: [`imm_core 单文件超过 ~400 行且职责可命名`, `heal 与 migration 需独立单测`, `compounder 调用 dehydrate_closed_steps 需稳定导入路径`]

### 方案模板
1. **画清依赖方向**：heal/migration/dehydration 依赖状态形状与工具函数，不反向 import LedgerManager 类体。
2. **模块边界**：`heal.py`（自愈）、`migration.py`（v1→v2）、`dehydration.py`（闭步 `child_evidence` / `focus_delta` 脱水）。
3. **门面 re-export**：`current_iteration_state.dehydrate_closed_steps` 薄包装，供 `imm-finish` / compounder 稳定调用。
4. **全量 unittest** 证明行为不变。

### Evidence
- `.imm/imm_core/current_iteration_state.py` 745→401 行；新增 `heal.py`（227）、`migration.py`（93）、`dehydration.py`（84）。
- `heal_current_iteration(..., is_v2_fn=..., derive_active_step_fn=...)` 使用 keyword-only 注入，见 `.imm/imm_core/heal.py`。
- U002 验收：`python3 -m unittest discover -s tests` 通过。

---
*沉淀日期: 2026-05-19 | 来源: Architecture Improvement Wave 3 U002*

## Pattern: Wire Orphaned Tested Code Into Production Synthesis

**领域**: Code Review / Subagent Arbitration
**描述**: 当某模块已有单测与 spec，但生产合成路径仍用简单拼接时，属于「测试孤岛」。更稳的做法是：按 Internal Package Migration 将模块移入 `imm_core/`，在唯一合成入口（如 `build_code_review_synthesis_from_outcomes`）调用其仲裁 API，并保留根目录兼容 shim 直至调用方迁移完毕。

**reusability**: high
**next_reuse_scenarios**: [`review_arbitration 类已测未接线模块`, `合成路径需 conflict_group 优先级与冲突报告`, `telemetry/arbitration spec 已存在但 runtime 未接入`]

### 方案模板
1. **内化**：`imm_core/review_arbitration.py` 为权威实现；根 `.imm/review_arbitration.py` 可保留 re-export shim。
2. **接入点**：在 `code_review_subagents.build_code_review_synthesis_from_outcomes` 对 child findings 调用 `arbitrate_child_findings`，输出 ordered findings + conflicts + unresolved 语义。
3. **测试**：`tests/test_imm_review.py` 覆盖仲裁与合成；spec：`docs/specs/archive/subagent-telemetry-arbitration-integration.spec.md`。

### Evidence
- `.imm/imm_core/code_review_subagents.py` 导入并调用 `arbitrate_child_findings`；同一 `conflict_group` 分歧时合成含冲突报告。
- U003 验收：全量 unittest 通过；计划 D6 遵循 architecture hub 的 Internal Package Migration 模式。

---
*沉淀日期: 2026-05-19 | 来源: Architecture Improvement Wave 3 U003*

## Pattern: Dev-Only Editable `imm_core` Without Changing Copy Install

**领域**: Developer Experience / Packaging
**描述**: 测试与开发机需要 `import imm_core` 时，不要用 `sys.path.insert` 散落 15 处。更稳的做法是在 `.imm/` 添加最小 `pyproject.toml`（`pip install -e .imm/`），让测试标准导入；同时**明确不改动** `scripts/install-local.sh` 的 copy-based 白名单安装（见 rejected-wave3-dev-install-boundaries）。

**reusability**: high
**next_reuse_scenarios**: [`tests/ 内 sys.path hack 清理`, `本地 imm_core 开发与 CI unittest`, `新贡献者 onboarding`]

### 方案模板
1. **`.imm/pyproject.toml`**：`[project]` 元数据 + `setuptools` 发现 `imm_core*`；无需 PyPI publish。
2. **测试**：移除 `tests/*.py` 中的 `sys.path.insert`；验证 `pip install -e .imm/` 后 `import imm_core` 成功。
3. **边界**：CLI wrappers 与 `install-local.sh` 行为不变。

### Evidence
- `.imm/pyproject.toml` 存在；`tests/` 下 `sys.path.insert` 计数为 0（Wave 3 后 grep）。
- U004：`pip install -e .imm/` 成功；5 个测试文件去掉 path hack；冗余 `setup.cfg`/`setup.py` 已删除（follow-up）。
- 拒绝项记录：`docs/solutions/rejected-wave3-dev-install-boundaries.md`。

---
*沉淀日期: 2026-05-19 | 来源: Architecture Improvement Wave 3 U004*

## Pattern: Registry-Backed Stale Doc Reference Detection

**领域**: Documentation Hygiene / Contract Truth
**描述**: 技能合并或 surface 退役后，历史 plan/spec 会留下指向已删除 `skills/*/SKILL.md` 或断裂 spec/plan 的引用；人工 grep 不可扩展。更稳的做法是独立脚本对照 `skills/registry.yaml` 与文件系统，扫描 `docs/` 下 markdown，区分 stale skill ref、死链 spec/plan、legacy `.imm/specs/`，并排除 glob 与 `upstreams/` 误报。

**reusability**: high
**next_reuse_scenarios**: [`架构审计后的文档清理批次`, `compound-debt 与人读报告互补`, `CI 可选 doc hygiene gate`]

### 方案模板
1. **`scripts/detect-stale-refs.py`**：`SKILL_REF_RE` / `DOC_REF_RE` / `LEGACY_SPEC_RE` + `load_registry_skills()`。
2. **运行**：`python3 scripts/detect-stale-refs.py docs/`；有效引用（如 `imm-work`）不误报。
3. **与 compound-debt 分工**：debt 分析学习沉淀缺口；stale-refs 分析路径真实性——可并存，不必塞进 `imm-compound-debt.py` 单体。

### Evidence
- 脚本路径：`scripts/detect-stale-refs.py`；对 `docs/` 扫描报告 95 条（83 stale skills + 12 broken legacy specs），有效 skill 未误报（U005 execution_evidence）。
- `skills/registry.yaml` 为 skill 存在性真源；U005 验收命令见 plan step 5。

---
*沉淀日期: 2026-05-19 | 来源: Architecture Improvement Wave 3 U005*

## Pattern: Runtime Truth Guards Before Historical Cleanup

**领域**: Runtime Architecture / Documentation Hygiene / Contract Truth
**描述**: 当 runtime 入口完成迁移后，不要先尝试清理所有历史 Plan/Spec 中的旧路径。更稳的做法是先把 active docs 和 packaged runtime docs 对齐到当前入口，再用 focused guard 阻止 retired runtime-current references 回流；历史学习可以保留旧路径，但必须标记为 historical 或 source-only evidence。

**reusability**: high
**next_reuse_scenarios**: [`runtime surface retirement`, `active docs 与历史 docs 混杂`, `packaged docs adapted copy 漂移`, `CLI/MCP/Python 入口迁移后防回归`]

### 方案模板
1. **当前真源先落地**: `CONTEXT.md` 和 packaged runtime docs 只写当前生产入口，例如 `plugins/immune-brain/runtime/immune_brain_runtime.ts` 与 `plugins/immune-brain/bin/imm-*`。
2. **历史材料显式降级**: `docs/solutions/architecture.md` 这类 durable hub 可保留旧 Python/MCP 路径，但在章节上标注 `Historical note`、`Superseded current-truth pattern` 或 `source-only reference`。
3. **guard 小而准**: 在 existing stale-ref script 上加 focused mode，例如 `scripts/detect-stale-refs.ts --runtime-truth CONTEXT.md README.md plugins/immune-brain/dist/docs`，不要把历史 `docs/plans/` 噪音变成本轮 blocker。
4. **大模块拆分保留 barrel**: 对 `imm_core.ts` 这类长期 import surface，先抽 `plan_core.ts` / `state_ledger.ts`，再让原文件 re-export，避免一次性 breaking change。

### Evidence
- `CONTEXT.md` Architecture Map 改为 Bun + TypeScript CLI runtime truth。
- `plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md` 改为 `imm-activation-plan` TypeScript runtime entrypoint。
- `scripts/detect-stale-refs.ts --runtime-truth` 与 `tests/active-runtime-docs-contract.test.ts` 锁住 retired runtime-current references。
- `plugins/immune-brain/runtime/imm_core.ts` 成为 compatibility barrel，implementation seams moved to `plan_core.ts` and `state_ledger.ts`。
- `plugins/immune-brain/tests/opencode-runtime.test.ts` checks OpenCode mapped commands against `list-commands --json`.

---
*沉淀日期: 2026-07-05 | 来源: Runtime Truth and Seam Hardening Plan U1-U4*

## Pattern update: Conservative Link Fixer Pairs With Read-Only Stale-Ref Detector

**领域**: Documentation Hygiene / Migration Safety
**描述**: 文档迁移（如 Python→TypeScript runtime 退役）会留下大量断链。修复器若猜测目标会引入错误重写。更稳的做法是配对两个脚本：只读检测器（`detect-stale-refs.ts`）报告全部断链，修复器（`fix-broken-links.ts`）**只重写替换目标经验证确实存在的链接**（migrated `.imm/specs/`→`docs/specs/`、workspace-prefix abs-path→repo-relative、`file://`→relative），对指向已删除且无 1:1 继任者的死链（退役 `.py`、`tests/test_*.py`、不存在的 skill）只报告不猜测。区分「行内代码中的 glob 通配符」与真链接，避免检测器误报。

**reusability**: high
**next_reuse_scenarios**: [`runtime 语言迁移后的文档修链批次`, `skill 合并/退役后的引用清理`, `CI 可选 doc hygiene gate 修复阶段`, `评估其他 skill 契约能力时的方法学`]

### 方案模板
1. **修复器三档决策**: 每条链接先算「预期仓库相对路径」，再检查目标存在性——存在则重写为 repo-relative，存在迁移映射则重写到新路径，否则报告死链。
2. **检测器与修复器分离**: 检测器只读、可用于 CI；修复器默认 `--preview`，`--write` 才落盘。两者共享链接分类逻辑但不共享 mutation。
3. **行内 glob 误报过滤**: `\*.md`、`055*.md`、`.imm/specs/*.spec.md` 出现在行内代码而非 `[text](url)` 时不是链接，检测器正则需排除或修复器跳过。
4. **能力分析需三源交叉**: 评估 skill「是否完整支持某能力」时，不能只读 dist 契约措辞；必须核对 runtime 实现与 tests，否则会高估。提示词规定 ≠ 已实现。

### Evidence
- `scripts/fix-broken-links.ts` 新增；对 `docs/` + `plugins/immune-brain/` + 根 README 预览报告 483 条可重写、228 条死链。
- `--write` 应用 483 条重写（117 文件）；`--historicalize` 将 227 条死链转为行内代码并插入 49 个横幅（15 历史 Plan/Spec 标注 `> Historical note:`，34 方案 Hub 标注 `> Note:`）；重扫 0 真实死链误报。
- `docs/solutions/contracts.md` key_files 从 128 条修剪为 75 条（53 条已退役 `.py` 路径剔除，保持 100% 存在性）。
- `tests/active-runtime-docs-contract.test.ts` + `tests/python-reference-boundary.test.ts` 全绿（12 pass）；`git diff --check` 干净。
- 能力分析反推案例：imm-compounder 契约写明「Discovery Indexing / Architecture Map Sync」，但 runtime 无对应实现、无测试；3 次工具调用推翻「完整支持」初判。

### reusability_critique_notes
- **Falsifiability**: 若修复器重写了不存在的目标，或重写后产生断链，则该模式失败。本轮重写+历史化后重扫 0 断链，单步 Plan U1 经过独立 QA (pass) 与 `imm-code-review` gate pass，未证伪。
- **Architecture entropy resistance**: 追加到既有 `Runtime Truth Guards` hub 而非新建文件——两者共享「历史清理需保守、先守当前真源」主题，不重复 ADR。
- **Evidence trail**: fixer 脚本、git diff、`imm-plan` validation/sync、QA 与 code-review gate 记录均可在仓库验证。

---
*沉淀日期: 2026-07-24 | 来源: Plan 2026-07-24-001 Step U1 (227 死链转行内代码 + 49 横幅 + contracts.md key_files 修剪 53 条退役 .py)*

## Pattern: File-Backed Authority State Needs Fail-Closed Locks and Lock-Time CAS

**领域**: Persistence / Concurrency / Recovery
**描述**: 对文件型 authority ledger，atomic rename 只能防止 partial bytes，不能保护 read-modify-write。可靠的最小协议是：既存 write lock 一律 fail closed；每次 authority mutation 在获取锁后重读 durable state 并比较版本；只有版本一致才 atomic rename。不能自动 reclaim stale lock，因为 user-space reclaim guard 自身崩溃后会递归产生同类 ownership/replacement race。

**reusability**: high
**next_reuse_scenarios**: [`多个进程修改同一 JSON 状态文件`, `checkpoint snapshot 与 authority mutation 并发`, `stale lock owner 已死亡但无法使用 kernel lock`, `CLI 状态机需要 crash-safe read-modify-write`]

### 方案模板
1. **读取时捕获版本**: 对 normalized durable state 计算稳定 hash；mutation 在内存中完成，但不直接保存。
2. **锁内验证并提交**: exclusive lock 成功后重新读取 durable state；版本不一致则拒绝 stale commit，版本一致才写同目录 `0600` temp、`fsync`、atomic rename。
3. **区分 authority 与 advisory 写入**: authority mismatch 必须报错；checkpoint snapshot mismatch 只放弃 advisory persist，不能覆盖较新的 authority state。
4. **锁恢复 fail closed**: live、fresh、malformed、initializing、stale lock 均不自动删除。health command 只报告路径、owner metadata 与人工恢复步骤；operator 独立确认所有 writer 已停止后再移锁。
5. **确定性交错测试**: 在 lock acquisition 前注入 replacement mutation，覆盖 Step、follow-up、review、Plan sync、finish/dehydrate 与 snapshot；断言 replacement state 保持 canonical。

### Evidence
- `plugins/immune-brain/runtime/state_ledger.ts` 的 `commitStateMutation` / `commitFollowUpMutation` / `commitStateIfUnchanged` 分别覆盖 authority CAS、target identity CAS 与 advisory snapshot。
- `inspectLedgerWriteLock` + `plugins/immune-brain/runtime/imm_core.ts` 的 `imm-heal` 输出六类 lock diagnostics，从不删除 lock。
- `tests/imm-follow-up-runtime.test.ts` 覆盖 stale Step/follow-up/review/Plan-sync/finish/dehydrate interleavings、sync interruption、operator recovery 与 replacement-owner preservation。
- 最终 QA 64 tests / 0 failures / 484 assertions；最终 completion review 111 focused tests / 0 failures / 639 assertions，exact changed-files gate pass。

### reusability_critique_notes
- **Falsifiability**: 若平台提供可靠的 kernel advisory lock、transactional DB 或单 writer actor，这个文件锁协议应被更简单的原生事务替代；它不是所有 persistence 的通用首选。
- **Evidence trail audit**: 结论来自多轮确定性 crash/interleave regression、独立 QA call-site 审查和最终 code-review gate，不来自仅有 happy-path 的测试。
- **Architecture entropy resistance**: 追加到 Architecture Hub，因为它扩展既有 Durable Evidence Persistence，而不是创建新的 lock framework 或第二状态存储。

## Pattern: Revised Plan Sync Must Atomically Consume Replanned Targets

**领域**: Workflow State Machine / Plan Sync / Recovery
**描述**: 当 QA 将当前 target 判为 `replan`，revised Plan sync 不能只清除全局 `requires_replan`。它必须在同一 Ledger commit 中归档 superseded target、清除 pending target、安装新 Plan signature，并暴露 replacement Step；否则旧 `replanning` target 会继续遮蔽新 Step，形成永久 Planner loop。

**reusability**: high
**next_reuse_scenarios**: [`持久化工作流支持 replan`, `旧执行目标被 revised Plan 取代`, `append-safe Plan sync`, `状态机需要 crash-consistent authority handoff`]

### 方案模板
1. Executor 对已失效的 repair target 记录 failure exit，不伪造成功 evidence。
2. 独立 QA 在 `ready_for_review` 边界记录 `replan`。
3. Planner sync 构造完整新 state：把 target 连同 execution/QA evidence 归档，清除 pending/replan flags，保留 completed prefix，写入 revised Plan signature 与 next action。
4. 用一次 lock-time CAS + atomic rename 提交；中断时只允许完整旧 replan checkpoint 或完整新 Plan checkpoint，不允许 mixed state。

### Evidence
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` 的 same-Plan sync 只在 signature 变化且 target 为 QA-confirmed `replanning` 时消费该 target。
- `tests/imm-follow-up-runtime.test.ts` 证明 injected sync interruption 保留完整旧 checkpoint，重试后原子暴露 replacement Step；普通 non-replanning follow-up 不被消费。
- U5 独立 QA 与最终 `imm-code-review` 均通过，无 actionable findings。

### reusability_critique_notes
- **Falsifiability**: 若 workflow 不持久化 target，或 Plan replacement 由数据库事务/事件日志原生完成，则不需要这套文件级 consumption protocol。
- **Evidence trail audit**: 证据包含真实 round-4 replan lifecycle、mixed-state blocker 复现、RED/GREEN interruption regression 和最终 gate pass。
- **Architecture entropy resistance**: 与前一模式共存于 Architecture Hub；不新增 generic dispatcher、replan daemon 或第二 Ledger。

---
*沉淀日期: 2026-07-11 | 来源: Pi imm-loop host autorun Plan U5 + independent QA + final imm-code-review*

## Pattern: Git-Owned Routing Policy as a Project-Level Fail-Closed Switch

**领域**: Architecture / Authority boundaries / multi-host governance
**描述**: 当需要按项目关闭某类新 authority（例如 v3 新计划创建）而不影响其他项目或宿主时，不要用 agent-local 配置（会跨环境分叉、无 Git 权威），也不要无条件改包行为（会切断无 Kernel 权威的宿主供给）。正确做法是项目级 Git-owned 路由策略文件：严格 canonical bytes 同时存在于 worktree 与 Git index 才 active；任何 present-but-untrusted 状态（malformed/untracked/tracked-deleted/drift/symlink/oversize）fail-closed；缺失即 legacy 兼容。运行时只读策略、绝不 stage/commit；激活是显式 `git add` 集成动作。关键点：guard 必须在 canonical dispatch 的 `prepareProjectAccess`/自动迁移之前执行，只匹配真正获取新 authority 的命令（`imm-plan --sync`），同 identity 的既有 Plan 继续可 work/review/finish（drain）。

**reusability**: high
**next_reuse_scenarios**: [`按项目禁用某类新 managed authority`, `多宿主包需要项目级 opt-in 行为开关`, `CLI 新增子命令需精确 manifest 断言同步`, `guard 必须早于自动迁移/recovery owner`]

### 方案模板

1. **单 wire 合约**: 固定 schema + canonical 序列化（2-space、字段顺序、trailing newline）+ 固定 SHA-256；不接受 formatting-equivalent 变体。
2. **两阶段 fail-closed**: worktree 出现即阻塞新 authority（无回退窗口）；worktree==index 字节相等且 hash 匹配才 active。
3. **Git 所有权**: `git ls-files --error-unmatch` + `git show :path` 验证 tracked 与 index bytes；runtime 永不 stage/commit。
4. **前置 guard**: 在 canonical dispatch 中、`prepareProjectAccess`/migration/recovery 之前执行；只匹配获取新 authority 的命令；测试用 seam 证明 rejection 先于任何写入。
5. **安全读取**: 唯一 canonical root、逐组件 symlink 拒绝、O_NOFOLLOW、read-time identity 重验。
6. **同 identity 例外**: current-format Ledger 能证明 canonical Plan identity 时放行，允许已有 Plan drain 到 finish。

### 验证依据

- `plugins/immune-brain/runtime/managed_task_routing_policy.ts`（严格 parser/投影）与 `immune_brain_runtime.ts:evaluateV3PlanSyncGate`（前置 guard）。
- `tests/managed-task-routing-policy.test.ts`、`tests/v3-plan-creation-retirement.test.ts`（seam/恢复 owner 证明）、`tests/imm-plan-routing-status-contract.test.ts`。
- Spec: `docs/specs/assurance-kernel-v4-p3-v3-creation-retirement.spec.md` §5。

### reusability_critique_notes

- **Falsifiability**: 若项目不需要按项目差异控制 authority，或运行时已有更强的 Git 权威通道，本模式不适用。
- **Evidence trail audit**: P3 U1/U2/U3 全部 QA pass + final review 通过；guard 前置性由 seam 测试与 recovery fixtures 字节不变证明。
- **Architecture entropy resistance**: 这是权威边界的既有模式（Git ownership 而非 host 认证），追加到 Architecture Hub 不引入新抽象。

---
Captured: 2026-08-13 | Source: Plan 2026-08-13-016 (P3)
