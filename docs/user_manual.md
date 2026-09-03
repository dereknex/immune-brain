# Immune-Brain 使用手册

Immune-Brain 是一套 Skill-explicit Managed 工作流，支持 Pi 与本地交互式 Claude Code，并提供两个独立 host-native 维护 Skill。用户可发现五个 public Skills：

- `imm-brainstorm`：澄清需求、约束、风险和非目标。
- `imm-planner`：创建或修订 Spec、Plan 和候选 TaskIntent。
- `imm-loop`：消费已验证的 Plan，协调执行、QA、Review、repair 和 settlement。
- `imm-pr-fix`：直接诊断并修复一个 GitHub PR，不创建 Managed authority。
- `imm-doc-prune`：在显式 manifest 批准后清理过期当前文档，不创建 Managed authority。

### `imm-doc-prune`

独立处理过期当前文档的清理。它盘点仓库全部 tracked 当前文档，机械筛选候选，输出精确 manifest，用户显式批准后才执行删除或编辑。Git history 是非权威文档的唯一历史档案；它不维护 `retired`/`superseded` 文档墓地。它不创建或修改 Spec、TaskIntent、TaskRecord 或 Kernel state；不删除 active/frozen Spec、TaskIntent、TaskRecord、tombstone 或其他 `.imm` authority；已由 Managed task 拥有的文档仍通过 `imm-loop` 继续。

Executor、QA、Review、learning 和 architecture exploration 都是
`imm-loop` 使用的内部 runtime roles/tools。Loop 内部 `pr-fix` role 与独立
`imm-pr-fix` Skill 共享诊断语义，但 authority boundary 不同。Executor、Review、
PR repair 和 test repair 同时遵守 Code Quality Guard 的正确性约束；QA 只判断
记录的 acceptance evidence，不执行风格门禁。

## 路由模型

Host 只在用户显式进入 Immune Skill 时启动 Managed Path；普通 host input 保持 host-native：

- 只读、解释、review-only、Plan-only 和明确 no-modification 请求保持 host-native，不创建 workflow authority。
- 普通仓库变更不会被自然语言自动分类；用户显式进入 `imm-brainstorm`、`imm-planner` 或 `imm-loop` 后才启动 Managed Path。
- 需求有重大歧义时进入 `imm-brainstorm`，回答全部 `BR-Q-*` 后再进入 `imm-planner`。
- 有效的 active Assurance/Kernel projection 保持权威；用户显式进入 `imm-loop` 后恢复，不自动改写普通输入。
- `imm-planner` 只产生候选计划和 TaskIntent，不自动 Enrollment。

```text
request
  -> host-native                    read-only / explanation / review-only
  -> imm-brainstorm                 unresolved material ambiguity
  -> imm-planner                    clear repository mutation
  -> imm-loop                       validated Plan or active task recovery
```

显式 Skill 使用项目现有结构，并只创建当前工作需要的 artifact 及其父目录。Runtime 不安装、覆盖或校验项目级 `AGENTS.md`、`IMMUNE.md` 或 `CONTEXT.md`。

## 五个 public Skills

### `imm-brainstorm`

用于需求澄清和风险暴露。它可以产生 brainstorm artifact，但不写实现代码、不激活 Plan，
也不拥有 Enrollment、Review 或 QA authority。`adversarial` 和 `roundtable` 是它的模式，
不是新的 Skill 入口。

### `imm-planner`

用于定义 Scope、Spec、Plan 和 Verification。它必须先读取 routing projection，保留
Brainstorm Trace，并让每个 Step 有明确 Result、Scope 和 Verification。Planner 不直接
写入已存在的 TaskIntent，也不绕过 literal-user Enrollment。

### `imm-loop`

是唯一的执行协调入口。它从 checkpoint 和 Kernel projection 继续工作，调用内部 roles：

| Internal role | Boundary |
| --- | --- |
| `executor` | 只修改当前 active Step 或已接受的 same-boundary follow-up |
| `test-fixer` / `pr-fix` | 只处理显式委派的测试或 PR blocker 文件 |
| `qa` | 只基于记录的 evidence 返回 pass/rework/replan |
| `code-review` / `ui-review` | 只读 Review；稳定 gate identifiers 仍为 `imm-code-review` 和 `imm-ui-review` |
| `arch-explorer` / `advisory-reviewer` | 只读探索和 advisory evidence |
| `compounder` | 只在闭环完成后写入 solution/ADR/memory learning |

这些 roles 由 `runtime/role_prompt_bridge.ts` 从 `runtime/prompts/` 或 packaged
`dist/role-prompts/` 加载，不经过 public Skill discovery。

### `imm-pr-fix`

独立处理 GitHub PR review feedback、merge conflict 和 CI failure。它以远端 PR
metadata 和 `imm-pr-diag` 快照为真源，只修改 blocker 相关文件，验证后推送 PR branch。
它不创建或修改 Spec、TaskIntent、TaskRecord 或 Kernel state；已由 Managed task 拥有的
PR 仍通过 `imm-loop` 继续。

## 执行边界

`imm-loop` 保持以下边界：

1. 没有 validated Plan 时回到 `imm-planner`。
2. Executor、QA、Review 和 Compounder 的职责由内部 role dispatch 提供，不能作为独立用户入口调用。
3. Scope expansion 回到 `imm-planner`；不能在当前 Step 中静默扩大范围。
4. Review authorization 和 Enrollment 是 literal-user/native TUI authority gates。
5. Tool result 必须返回持久化 projection 和 `next_action`，中断后从 Kernel state 恢复。
6. 终态返回 `phase=done` 和 `next_action=none`；取消、失败和 settlement 不靠 promise resolution 推断。

内部 runtime 操作包括 `imm_canary_enrollment`、`imm_kernel_canary` 和必要的 Kernel CLI。它们不是 public Skills，不构成第二套用户工作流。

## 验证与发布

公共 surface 由 `skills/registry.yaml` 声明，必须与五个 `skills/*/SKILL.md`、对应
`dist/imm-*.md`、package manifest 和实际 Pi loader 结果一致。未注册的旧 Skill 目录、
旧 dist entry files 和兼容 alias 不应重新加入 registry。

验证时至少运行：

```bash
bun scripts/sync-dist-docs.ts --check
bun test
```

`bun test` 中若本地明确停用了 `package.json` 的 `pi.extensions`，依赖 host extension
发现的测试会失败；恢复 shipped extension manifest 后再判断真实 package/loader 结果。
