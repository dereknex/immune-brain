---
title: Rejected Wave 3 Dev Install Alternatives
rejected: true
reusability: medium
key_files:
  - docs/specs/architecture-improvement-wave-3.spec.md
  - scripts/install-local.sh
  - .imm/pyproject.toml
---

# Rejected: Wave 3 Dev Install Boundaries

## 拒绝：改动 `install-local.sh` 的 copy-based 安装

**原因**: `architecture-improvement-wave-3` spec 将 copy-based 安装列为 explicit non-goal。生产/跨项目安装路径必须继续由 `scripts/install-local.sh` 复制白名单文件树，而不是依赖开发机上的 editable 包或 symlink。

**证据**: `docs/specs/architecture-improvement-wave-3.spec.md` §4 Non-Goals —「不改变 `install-local.sh` 的 copy-based 安装方式或 CLI wrapper 行为」；U004 验收仅添加 `pip install -e .imm/` 供本仓库测试，未修改 `install-local.sh`。

## 拒绝：将 `imm_core` 发布到 PyPI 或作为全局默认依赖

**原因**: 本仓库的 `imm_core` 是工作流运行时内部包，不是对外发布的库。全局/项目外 pip 安装会模糊 copy-install 边界并增加版本漂移风险。

**证据**: 同上 spec §4 —「不将 `imm_core` 发布到 PyPI」；`.imm/pyproject.toml` 仅声明本地 `imm-core` 包名与 `setuptools` 发现，无 publish 配置。

---
*沉淀日期: 2026-05-19 | 来源: Architecture Improvement Wave 3 compounder*
