# Spec: addyosmani agent-skills upstream + skill anatomy hardening

**任务 ID**: IMM-ADDY-UPSTREAM-001  
**负责人**: Planner  
**状态**: Accepted

## 1. 目标

- 将 **[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)** 作为 **`upstreams/` git submodule** 纳入本仓库，与现有方法论上游并列，便于本地对照与确定性摘要（含 `.imm/imm-upstream-sync.py`）。
- 产出**团队内对照清单**：目录与 skill 映射、与 `imm-*` / compound-engineering 的**重叠矩阵**、借鉴分类（结构 / 摘录 / 不引入）。
- 借鉴上游的 **anti-rationalization** 与 **显式验证** 做法：在 **Immune-Brain BASELINE** 中固化可选增强段落契约，并对 **`imm-work`、`imm-executor`、`imm-planner`、`imm-qa`** 四套协作枢纽 skill **强制**补齐 **Rationalizations**、**Red Flags**、**Verification** 三节（与现有 Boundary / Output artifact 并存）。
- 提升**入站可发现性**：在 `README.md` 或 `skills/imm-brainstorm/SKILL.md` 增加精简 **「入站任务 → 首个 imm-*」** 路由表（不与 `imm-work` Decision Tree 矛盾）。
- **渐进披露**：在 `docs/reference/` 增加至少一份可链接的 **质量检查清单**（安全或代码审查向），并由 `imm-code-review`（及必要时 `imm-ui-review`）用单行指向该文件，避免把长 checklist 贴入 `SKILL.md`。

## 2. 功能需求

### 2.1 Submodule 与文档

- 新增 submodule：`upstreams/addy-agent-skills` → `https://github.com/addyosmani/agent-skills.git`。
- `README.md` 中 upstreams 枚举与 `.gitmodules` 同步；补充**简短维护策略**（例如：默认跟踪上游默认分支、重大对齐前可钉 commit、可用 `python3 .imm/imm-upstream-sync.py` 做本地摘要 —— 表述与脚本真实行为一致即可）。

### 2.2 对照清单

- 新建 `docs/reference/addy-agent-skills-contrast.md`（文件名可由执行步微調，但必须落在 `docs/reference/`）。
- 必含：**skill 清单映射**、**重叠矩阵**（标明主权威来源：本仓库 `imm-*` vs `upstreams/compound-engineering` vs `upstreams/addy-agent-skills`）、**借鉴三分类**、submodule **更新策略**一句话。

### 2.3 Skill 解剖与 BASELINE

- `skills/BASELINE.md` 增加章节（或单独 `skills/SKILL-ANATOMY.md` 并由 BASELINE 引用）：定义 **Rationalizations**（借口 / 反驳表）、**Red Flags**、**Verification** 的写作目的与最小结构；标明 **枢纽 skill** 必须包含三节及推荐二级标题拼写。
- `imm-work`、`imm-executor`、`imm-planner`、`imm-qa` 的 `SKILL.md` 各增加上述三节；Verification 须与本仓库证据路径一致（`imm-work record-execution`、`imm-review`、`python3 -m unittest` 等），不得抄袭上游无关命令。

### 2.4 路由与 reference

- **路由表**：≤20 行，覆盖常见入站（模糊需求、仅有任务描述、已有计划、纯审查 / PR 修复等），默认 continue 仍为 `imm-work` 的语义保持不变。
- **Checklist 文件**：新建 `docs/reference/` 下至少一个 markdown；内容可为精炼条目 + 指向 submodule 内详细 checklist 路径（相对路径），避免维护两份全文。
- `imm-code-review`（及若 checklist 含前端可验收项则 `imm-ui-review`）增加指向该 reference 的一行「详见 …」。

### 2.5 契约测试与计划校验

- `tests/test_skill_contracts.py`：增加对 BASELINE 解剖表述与四个枢纽 skill 三节存在的稳定断言（标题或固定短语，由执行步与现有测试风格对齐）。
- `python3 .imm/imm-plan.py docs/plans/2026-05-10-051-feat-addy-upstream-skill-anatomy-plan.md --json` 通过；`python3 -m unittest tests.test_skill_contracts` 通过。

## 3. 验收标准

- [x] `.gitmodules` 含 `upstreams/addy-agent-skills`，且 `git submodule update --init upstreams/addy-agent-skills` 可检出。
- [x] `README.md` upstreams 列表含新路径；维护策略与 `imm-upstream-sync` 引用准确。
- [x] `docs/reference/addy-agent-skills-contrast.md`（或同等路径）存在且满足 §2.2。
- [x] `skills/BASELINE.md`（或 `skills/SKILL-ANATOMY.md` + BASELINE 引用）定义三节契约；`imm-work`、`imm-executor`、`imm-planner`、`imm-qa` 均含 **Rationalizations**、**Red Flags**、**Verification**。
- [x] 路由表落在 `README.md` 或 `imm-brainstorm/SKILL.md`；reference checklist 存在且 review skill 已链接。
- [x] 契约测试与 `imm-plan.py --json` 校验通过。

## 4. 非目标

- 不将 addy 22 skills **整体复制**进本仓库 `skills/` 或替换 `imm-*` 编排。
- 不改 `.imm/imm-plan.py` 步数算法或运行时 append 语义（除非验收发现校验器硬性阻断新增 frontmatter —— 若出现则单独记录为 blocker）。
- 不在此 Epic 内重写 `IMMUNE.md` 全文；若路由表与宪法冲突，以 IMMUNE 为准并缩小路由表述。

## 5. 依赖

- 上游仓库公开可读；执行环境可执行 `git submodule add`。
- 既有 `tests/test_skill_contracts.py`  substring 契约：`README.md` 与 `docs/reference/workflow-and-subagents.md` 拼接表面不改删既有断言句除非同步改测试。
