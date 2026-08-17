> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Live Inventory Source of Truth

**领域**: Infrastructure validation / Installer documentation / Skill discovery
**描述**: 当系统组件（如 Skills）可以通过目录扫描或清单文件动态发现时，系统中的所有消费面（安装器、健康检查、文档）都不应再维护静态的成员清单。优先把动态扫描结果设为唯一的 source of truth，确保随着组件新增，所有验证与说明自动对齐。

**reusability**: high
**next_reuse_scenarios**: [系统健康检查工具需要验证“所有必装组件是否到位”, 安装器 README 需要枚举“当前支持的所有技能”, 任何基于静态列表且需要随目录结构变化而手动更新的验证逻辑]

## 场景

- **安装器文档**: README 保留了一份静态 skill 清单，新增 skill 后文档即失效。
- **自愈式验证**: 类似 `imm-heal` 的健康检查工具硬编码了 `REQUIRED_SKILLS` 数组，导致新增 alias 或组件后，健康检查误报失败。
- **环境迁移**: 在不同环境或不同分支间切换，硬编码的列表无法反映当前分支的真实组件集合。

## 方案模板

1. **定义扫描原语**: 确立组件的“身份证”（例如 `skills/*/SKILL.md` 的存在）。
2. **替换硬编码常量**: 在 Python/Bash 逻辑中，将 `REQUIRED_SKILLS = ["a", "b"]` 替换为动态扫描逻辑（如 `glob.glob("skills/*/SKILL.md")`）。
3. **建立同步契约**: 所有的消费面（`install-local.sh`, `imm-heal.py`, `README.md`）都引用相同的扫描逻辑或其输出。
4. **验证幂等性**: 确保新增一个空文件夹或不符合契约的文件不会破坏扫描逻辑。

## 可复用前提

- 组件有统一的存放路径和明确的标志位（Manifest 文件）。
- 扫描逻辑执行成本低，可以在每次验证时实时运行。
- 系统架构允许“按需发现”而非必须“预置注册”。

## 验证依据

- `scripts/install-local.sh` 通过扫描 `skills/*/SKILL.md` 动态收集安装项。
- `.imm/imm-heal.py` 此前硬编码了 `REQUIRED_SKILLS`，导致新增 `prep`/`run` 等 alias 技能后验证失败。修复后改为扫描 live manifests，实现了验证逻辑与文件系统的实时对齐。
- [2026-05-19-004-fix-heal-skill-inventory-parity-plan.md](docs/plans/2026-05-19-004-fix-heal-skill-inventory-parity-plan.md) 闭合了此项修复，验证通过。

## 约束与建议

- **优先 Manifest**: 尽量通过扫描 Manifest 文件（如 `SKILL.md`）而非仅仅扫描文件夹名，以确保发现的是有效组件。
- **容错处理**: 扫描逻辑应能优雅处理权限问题或路径不存在的情况。
- **避免双向依赖**: 健康检查工具依赖目录结构是合理的，但目录结构不应反向依赖健康检查工具的实现。

---
*沉淀日期: 2026-05-19 | 来源: imm-heal skill parity fix*

