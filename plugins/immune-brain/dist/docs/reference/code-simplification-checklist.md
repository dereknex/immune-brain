# Code simplification lens（渐进披露）

本文件是 **索引**：原则全文以 source repository 的 upstream submodules 为准，插件包不随附这些 upstream 全文，避免在本仓库重复维护。

## 范围解析优先级

简化 review 前必须先锁定范围，按以下顺序解析：

1. **用户显式指定**（文件、目录、函数）—— 权威，不扩大。
2. **`git diff <base>...HEAD`** —— 分支 diff，覆盖 PR 前整体审查场景。
3. **`git diff HEAD`** —— staged + unstaged 变更。
4. **空范围 → 停步追问**，不猜测。

## 三透镜检查维度

| 透镜 | 关键信号 |
|------|----------|
| **复用** | 新写逻辑与已有 utility 重复；内联代码可用已有 helper 替代；跨文件出现 copy-paste 变体 |
| **质量** | 3+ 层嵌套条件；冗余状态或派生值可直接计算；stringly-typed 代码应使用常量或枚举；冗余注释解释 what 而非 why；死代码或未使用的导入 |
| **效率** | 冗余计算或重复 I/O；可并行的独立操作被串行执行；热路径上新增阻塞逻辑；无变更检测的循环状态更新 |

## 何时不该简化

- 代码已经清晰可读 —— 不为简化而简化。
- 还不理解代码为什么这样写 —— 先理解再动手（Chesterton's Fence）。
- 性能关键路径上「更简洁」的写法会可测量地变慢。
- 即将整体重写该模块 —— 简化即将丢弃的代码是浪费。

## 深度参考（submodule 全文）

| 主题 | 深度参考 |
|------|----------|
| 五原则 + 模式表 + Chesterton's Fence + Rule of 500 | addy-agent-skills code simplification skill in the source repository upstreams |
| 范围解析 + 三 reviewer 协议 + 验证合同 | compound-engineering simplify-code skill in the source repository upstreams |

## Immune-Brain 边界

简化 findings 仍走 `imm-code-review` 的 `direct_fix` / `new_slice` 路由，不引入新 authority path。流程边界以 `IMMUNE.md` 与 hub `imm-*` skills 为准。
