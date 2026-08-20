# Functional Spec: Immune-Brain 核心阶段对抗机制增强 (Adversarial Mechanisms Hardening)

## 1. 背景与目标
在目前的 `Immune-Brain` 多 Agent 协同系统中，对抗式机制（如 `imm-brainstorm` 的 Inline Narrowing Challenge 与 `imm-preplan-review` 的 Relentless Grilling）极大地减少了需求漂移和模糊设计。
然而，在以下三个核心阶段中，仍存在对 Agent 的过度“单点信任”，导致：
1. **Planner 阶段**：生成的 Plan 步骤可能存在隐性依赖、缺乏回滚设计或对 Spec 进行悄悄剪裁。
2. **Executor 阶段**：执行者容易顺手清理无关代码、加入未来扩展，导致 Surgical Changes（外科手术式修改）原则失效。
3. **Compounder 阶段**：生成的总结容易流于表面，沉淀空泛的“废话式经验”，或未经充分证据验证的“伪规律”。

本规格定义了在这三个核心阶段中，如何通过更新规则和引入强力的“对抗式拦截”来硬化防御网络。

---

## 2. 核心对抗机制设计

### A. Planner 阶段: "Devil's Advocate" (魔鬼代言人) 规划预审
在 Planner 拆分 Plan 之后、提交用户审批前，强制通过规约或红方子 Agent 注入一个批判性的“破坏测试”视角。
- **机制定义**：Planner 必须在完成 Plan 草案后自我启动或指派 "Devil's Advocate" 机制进行“脆弱性盘问”。
- **三大拷问红线**：
  1. **回滚弹性 (Rollback Resilience)**：如果 Step N 运行中途失败，前序步骤是否留有可恢复的快照或回滚指导？
  2. **验证虚无性 (Verification Vanity)**：校验步骤的 `Verification` 是不是流于形式？是否能够直接被客观脚本或严苛断言所“卡死”？
  3. **Spec 稀释检测 (Spec Dilution Detect)**：是否存在因为当前 Executor 执行代价大，而在 Planner 中对 Spec 需求点进行无感剪裁或“悄悄忽略”？
- **规约落地**：Planner 生成的 Plan 中必须包含魔鬼代言人的审计项及回答（例如 `Devil's Advocate Audit`）。

### B. Executor 阶段: "YAGNI Red-Line Gate" (极简主义红线阻尼)
Executor 通常容易由于习惯顺手修复相邻文件（如格式整顿、多余重构）或加入未来设计。
- **机制定义**：Executor 在编写完代码但还未提交验证前，强制执行一轮“极简审计”。
- **三大剪裁原则 (Clipping Principles)**：
  1. **无感重构拒绝**：严禁在当前 Step 任务范围之外进行任何“格式美化”或“架构顺手调整”。若确有必要，必须通过 Plan 调整或 Follow-up 单独排步。
  2. **未来扩展阉割**：任何未在当前 Active Step 中被明确指派的接口、参数、冗余抽象（YAGNI - You Aren't Gonna Need It），即使代码再优雅，也属于 Blocker，必须立刻删除。
  3. **外科边界核准 (Surgical Check)**：每一行变动必须有对应的 step `Result` 与 `Verification` 的精确映射。
- **规约落地**：Executor 规则中明确极简主义的强制性，QA 拥有依据 YAGNI 直接 Rework 驳回的权利。

### C. Compounder 阶段: "Debate & Evidence Critique" (经验真伪辩论)
防止沉淀形式化的“废话经验”或由于偶然成功而提炼的“假规律”。
- **机制定义**：Compounder 在抽取 reusable guidance 时，必须经历“挑剔编辑（Critical Editor）”的反思式论证辩论。
- **辩论三问 (Critique Triad)**：
  1. **普适性证伪 (Falsifiability)**：这个沉淀的 solution 是否适用于其他项目或其它类似场景？它真的是一个“普遍规律”吗？
  2. **证据链盘点 (Evidence Trail Audit)**：是否有本任务产生的具体回归测试、监控数据、或 benchmark 脚本能**数学化/客观化**地证明这一最佳实践？
  3. **架构地图对抗 (Architecture Entropy Resist)**：新沉淀 of 经验是否会导致知识库无限膨胀，或与已有 ADR 和 pattern 重复/冲突？如果有，必须采用 `Thematic Append-First` 合并，而不是新建文件。
- **规约落地**：Compounder 必须在 output artifact 中包含 `reusability_critique_notes` 以及辩论事实。

---

## 3. 变更范围
我们将修改 `plugins/immune-brain/dist/` 下的核心规则文件，将以上三大对抗规约硬编码入系统底层规约：
1. **`plugins/immune-brain/dist/imm-planner.md`**：加入魔鬼代言人规划规则与 Trace 映射防漏规则。
2. **`plugins/immune-brain/dist/imm-executor.md`**：加入极简主义红线阻尼、YAGNI 审计条款。
3. **`plugins/immune-brain/dist/imm-compounder.md`**：加入辩论三问、经验普适性证伪及 key_files 和 ADR 强一致性规则。
4. **对应的 `skills/` 下的 `SKILL.md` 文件**（作为 runtime 的外壳描述，同步硬化语义描述）。

---

## 4. 验证方法 (Verification Plan)
- **静态验证**：所有更新后的 `.md` 规范文件必须遵循 `BASELINE.md` 的书写约定。
- **结构验证**：使用 `imm-plan docs/plans/2026-05-25-001-feat-imm-adversarial-mechanisms-plan.md --json` 验证规划结构是否完美契合，所有 brainstorm mappings 和 trace coverage 均达到 100%。
