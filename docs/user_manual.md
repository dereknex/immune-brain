# Immune-Brain 使用手册

Immune-Brain 是一套 Managed-by-default 的 Pi 工作流。用户可发现的入口只有三个 public Skills：

- `imm-brainstorm`：澄清需求、约束、风险和非目标。
- `imm-planner`：创建或修订 Spec、Plan 和候选 TaskIntent。
- `imm-loop`：消费已验证的 Plan，协调执行、QA、Review、repair 和 settlement。

Executor、QA、Review、repair、learning、architecture exploration 和 bootstrap 都是
`imm-loop` 使用的内部 runtime roles/tools，不是可发现的 Skill，也没有兼容 alias。

## 路由模型

Host 先按请求分类：

- 只读、解释、review-only、Plan-only 和明确 no-modification 请求保持 host-native，不创建 workflow authority。
- 清晰的仓库变更自动进入 Managed Path；用户不需要输入“Managed Path”。
- 需求有重大歧义时先进入 `imm-brainstorm`，回答全部 `BR-Q-*` 后再进入 `imm-planner`。
- 有效的 active Assurance/Kernel projection 直接恢复到 `imm-loop`，不重新规划。
- `imm-planner` 只产生候选计划和 TaskIntent，不自动 Enrollment。

```text
request
  -> host-native                    read-only / explanation / review-only
  -> imm-brainstorm                 unresolved material ambiguity
  -> imm-planner                    clear repository mutation
  -> imm-loop                       validated Plan or active task recovery
```

第一次进入 Managed Path 时，runtime 会通过 `runtime/bootstrap.ts` 和
`runtime/bootstrap-templates/` 严格、幂等地建立最小项目状态。Bootstrap 不是 public Skill；
partial、incompatible 或 symlinked state 会 fail closed。

## 三个 public Skills

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

## 执行边界

`imm-loop` 保持以下边界：

1. 没有 validated Plan 时回到 `imm-planner`。
2. Executor、QA、Review 和 Compounder 的职责由内部 role dispatch 提供，不能作为独立用户入口调用。
3. Scope expansion 回到 `imm-planner`；不能在当前 Step 中静默扩大范围。
4. Review authorization 和 Enrollment 是 literal-user/native TUI authority gates。
5. Tool result 必须返回持久化 projection 和 `next_action`，中断后从 Kernel state 恢复。
6. 终态返回 `phase=done` 和 `next_action=none`；取消、失败和 settlement 不靠 promise resolution 推断。

内部 runtime 操作包括 `imm-route --json <request>`、`imm_canary_enrollment`、
`imm_kernel_canary` 和必要的 Kernel CLI。它们不是 public Skills，不构成第二套用户工作流。

## 验证与发布

公共 surface 由 `skills/registry.yaml` 声明，必须与三个 `skills/*/SKILL.md`、对应
`dist/imm-*.md`、package manifest 和实际 Pi loader 结果一致。旧 Skill 目录、旧 dist
entry files 和兼容 alias 不应重新加入 registry。

验证时至少运行：

```bash
bun scripts/sync-dist-docs.ts --check
bun test
```

`bun test` 中若本地明确停用了 `package.json` 的 `pi.extensions`，依赖 host extension
发现的测试会失败；恢复 shipped extension manifest 后再判断真实 package/loader 结果。
