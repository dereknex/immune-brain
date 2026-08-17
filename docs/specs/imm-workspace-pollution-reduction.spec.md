# Spec: 工作空间污染控制（`.imm` 收敛）

**任务 ID**: IMM-TASK-002  
**负责人**: Planner  
**状态**: Draft  

## 1. 目标
将 Immune-Brain 从“项目内包含完整 workflow 执行脚本”转为“项目仅保留可复用状态与计划证据”，避免在任意业务仓库里留下 `.imm/` Python 工具文件（如 `imm-work.py`、`imm-plan.py`、`imm-review.py`）污染项目目录。

## 2. 核心需求
- `.imm/` 在项目内保留：
  - `.imm/memory/`
  - `.imm/specs/`
  - `.imm/templates/`（如适用）
- 同时保留一份本地迁移回退清单（`.imm-backup/rollback-to-project-local-engine.md`）便于在兼容场景回退。
- 运行工具从用户级安装路径提供，默认由 skill/安装入口统一访问。
- `legacy-installer` 与相关文档保持向后兼容，允许检测到遗留项目时提供迁移提示并不直接阻塞流程。
- 第一次运行在有遗留 `.imm/imm-*.py` 项目的仓库里，不能因缺失新路径直接报错中断。

## 3. 非目标
- 一次性迁移第三方历史仓库全部历史提交。
- 统一整个行业生态的全局工具安装标准。
- 重写 `imm-work`/`imm-review`/`imm-plan` 的业务语义。

## 4. 验收标准 (QA Points)
- [ ] `.imm/` 不再承载作为执行引擎的 Python 工具文件，仓库级文档明确工具来源与执行入口。
- [ ] 项目级 `.imm/memory/`、`.imm/specs/` 与 `docs/` 能继续支持现有 plan/work 流程。
- [ ] 遗留项目场景下给出可执行迁移动作（备份/清理/重建）而不是“硬失败”。
- [ ] 安装与检查命令仍能发现/验证 imm skill 的可用性。

## 5. 依赖项
- `.imm/specs/plan-work-review-rewrite.spec.md`（小步闭环约束）
- `IMMUNE.md`（流程与边界规则）
- 当前 `scripts/legacy-installer.sh` 与 `imm-*` 入口文档
