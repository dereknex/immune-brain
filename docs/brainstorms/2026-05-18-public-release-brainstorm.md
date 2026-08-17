# Brainstorming: Public Immune-Brain Release Strategy

## Conclusion
采用 **“双仓库 + 路径脱敏同步”** 的模型。公开发布版定位为 **“纯净的 Immune-Brain 引擎”**。
1. **内部仓库 (Internal Repo)**：即当前仓库，作为核心引擎开发、项目实战、以及私有知识 (Learnings) 的主战场。
2. **公开仓库 (Public Repo)**：命名为 `immune-brain-core`，仅包含框架引擎、核心 Skills、协议文档和引导脚本。

## Scope
### In-Scope (公开仓库包含内容)
- `.imm/`：核心引擎逻辑 (`imm_core`, `imm-*.py`)。
- `skills/`：通用的角色定义 (`imm-planner`, `imm-work` 等)。
- `scripts/`：安装脚本 (`install-local.sh`, `imm-cli-launcher`)。
- `docs/reference/`：系统协议、触发目录、子代理政策。
- `docs/specs/`：仅包含系统级 Spec。
- `tests/`：通用的合约与引擎测试。
- `IMMUNE.md`, `README.md` (脱敏版), `BASELINE.md`。

### Out-of-Scope (排除在外的私密内容)
- `.imm/memory/`：任何运行态状态、Session 历史、私有 MEMORY。
- `docs/plans/`, `docs/specs/` (项目特有)：具体的迭代计划和需求。
- `docs/brainstorms/`：项目设计过程。
- `docs/solutions/`：项目沉淀的特定解决方案。
- `upstreams/`：所有的 Git Submodules (BR-REQ-3)。

## Assumptions & Risks
- **依赖降级**：引擎脚本需支持 `upstreams/` 缺失时的降级模式 (BR-DEC-2)。
- **历史脱敏**：使用 `git-filter-repo` 提取 core 路径 (BR-DEC-1)。

## Brainstorm manifest
- BR-REQ-1: 物理隔离项目私有数据与框架引擎代码。
- BR-REQ-3: `upstreams/` 不进入公开仓库，不提供自动拉取脚本。
- BR-DEC-1: 使用 `git-filter-repo` 进行历史提取同步。
- BR-DEC-2: 脚本引擎需支持 `upstreams/` 缺失时的降级模式。
- BR-OUT-1: 不提供任何辅助恢复 `upstreams/` 的自动化工具。
