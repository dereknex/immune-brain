# imm-test-prune：测试膨胀治理决策记录

状态：已接入为第 8 个 public Skill。契约以 [`plugins/immune-brain/dist/imm-test-prune.md`](../../plugins/immune-brain/dist/imm-test-prune.md) 为准，本文只记录背景与决策。来源：[dereknex/immune-brain#205](https://github.com/dereknex/immune-brain/issues/205)。

## 背景

vibe coding 中，生成测试几乎零成本，删除测试却没有明确的负责人，测试规模因此单向增长。2026-10-10 本仓库统计：

- 166 个测试文件、约 1871 个用例、约 6.2 万行测试代码，非测试 TS 约 4.1 万行；
- 38 个 `*-contract.test.ts`；
- 91 个测试直接读取 `.md`。

## 决策

1. **分层落位**：
   - 本 Skill 只负责低频、需审批的存量审计与清理。
   - 生成阶段约束（单行为、不镜像实现、先查已有覆盖）属于 AGENTS.md、Executor role prompt 与 Review 检查清单，另立切片处理。
   - 测试规模度量属于只读脚本，不进入 Skill。
2. **与 `imm-doc-prune` 的边界**：
   - 纯文档存在或措辞测试仍归 doc-prune，本 Skill 将其标为 `DEFER_DOC_PRUNE`。
   - 测试结构与行为覆盖归本 Skill。
   - 两份契约互相写明这一边界。
3. **跨项目适用**：
   - 契约不绑定 bun 或任何特定 runner，只使用目标仓库已有的测试、覆盖率和静态检查命令。
   - 从不安装覆盖率工具或修改其配置。
4. **覆盖率按能力分级**（`isolated` / `file` / `unavailable`）：
   - 可用时强制使用：
     - 基于包含关系的 `DELETE`，以及会丢弃用例的 `MERGE`，必须证明保留测试覆盖的行是被删测试覆盖行的超集；
     - Verify 阶段对基线涉及的源码文件做前后行覆盖对比，覆盖下降即阻断。
   - 不可用时降级：基于包含关系的删除保持 `UNVERIFIED`，不执行；只做保留全部输入与断言的结构性重构。
   - 行覆盖只是删除的必要条件，不是充分条件，仍需比较断言强度。
5. **不引入 mutation testing 依赖**：属于依赖变更，不在本 Skill 内决定。
6. **首个切片已完成**：测试中写死的 public Skill 名数组改为由 `tests/helpers/public-skills.ts` 从 registry 派生。唯一的显式权威清单保留在 `plugins/immune-brain/tests/skill-registry-consistency.test.ts`。
