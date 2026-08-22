# Plan: Skill-Explicit Managed Path Routing

## Result

普通 Pi host input 不再自动进入 Managed Path；只有显式 Immune-Brain Skill 启动新工作流，已有 active Assurance 仍自动恢复。

## Step 1

### Result

删除 host input 的自动 Managed Path 文本路由和失败注入；保留 active backend claim、repairable stale claim、Assurance projection 的恢复；同步运行时入口、bootstrap 说明、公开文档、dist 镜像和契约测试。

### Scope

- `plugins/immune-brain/.pi-extension/imm-canary-work.ts`
- `plugins/immune-brain/runtime/managed_path_router.ts`
- `plugins/immune-brain/runtime/bootstrap.ts`
- `plugins/immune-brain/BASELINE.md`
- `plugins/immune-brain/README.md`
- `plugins/immune-brain/USER_GUIDE.md`
- `IMMUNE.md`
- `CONTEXT.md`
- `plugins/immune-brain/runtime/bootstrap-templates/AGENTS.md`
- `plugins/immune-brain/runtime/bootstrap-templates/IMMUNE.template.md`
- `tests/managed-default-routing-contract.test.ts`
- `tests/direct-first-routing-contract.test.ts`
- focused extension/runtime tests and packaged mirrors as required by existing sync contracts

### Verification

- `bun test tests/pi-canary-work-extension.test.ts tests/managed-default-routing-contract.test.ts tests/direct-first-routing-contract.test.ts`
- `bun test tests/bootstrap* tests/plugin-package-runtime.test.ts tests/dist-docs-sync-contract.test.ts`
- `bun test`
- `git diff --check`

### Boundary

Do not remove Kernel Assurance routing, native enrollment, QA, Review, authorization, or completion. Do not alter unrelated legacy runtime islands.
