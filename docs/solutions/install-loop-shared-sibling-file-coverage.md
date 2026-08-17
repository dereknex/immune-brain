# Pattern: Install Loop Shared Sibling File Coverage

**领域**: Install script hygiene / Skill distribution  
**描述**: 当 install 脚本通过目录循环复制一组子目录时，source 根目录下的共享文件（不属于任何子目录）不会被循环覆盖，需要显式增加 copy / check / uninstall 三段处理。

**reusability**: medium  
**next_reuse_scenarios**: [install 脚本同时管理一组子目录与共享根文件, 安装后运行时通过相对路径引用共享文件, 添加新的 source-root 级别共享文件时需要补齐 install coverage]

## 可复用前提

- Install 脚本的主安装循环只遍历 `source_dir/<name>/` 形式的子目录。
- Source 根目录下存在一个或多个被子目录内容引用的共享文件（如 `BASELINE.md`）。
- 这些共享文件的安装目标路径由 install 脚本独占管理（无其他工具写入同一路径）。

## 经验规则

1. **Install**: 在目录循环结束后，对每个共享文件单独执行 `cp`。用 source-absent guard（`if [[ -f ... ]]`）防止 source 消失时静默跳过但 check 随即失败，而不是直接 `cp`（后者会在 source 不存在时 error exit，吞掉明确错误信息）。
2. **Check**: 在 check 函数中单独断言共享文件的存在（`[[ -f && ! -L ]]`）；拒绝 symlink，区分"文件正确"与"文件缺失/被换成 symlink"两种状态。
3. **Uninstall**: 用 `[[ -f && ! -L ]]` 判断再删除；用 `elif [[ -e ]]` 守住非受管文件（防止误删用户自己放在同路径的文件）。
4. **Test**: 在安装测试中补齐三个断言：安装后 presence 断言、`--check` 在文件缺失时失败断言、卸载后 absence 断言。前两个可嵌入现有测试，`--check` 失败断言需独立测试用例。
5. **Marker 取舍**: 单个受管文件不需要 marker 系统（marker 系统为目录设计）。路径由 install 脚本独占管理 → 可直接无条件 copy/delete。

## 验证依据

- `scripts/install-local.sh` 在技能目录循环后显式 copy `skills/BASELINE.md` → `~/.agents/skills/BASELINE.md`。
- `check_install` 函数追加了 `[[ -f && ! -L ]]` 对 `BASELINE.md` 的断言，check 在文件缺失时以非零退出。
- `uninstall_skills` 函数在 `remove_legacy_skills` 后追加了 BASELINE.md 的受管删除路径。
- `tests/test_install_local.py` 新增 `test_check_fails_when_baseline_md_is_missing` 与两处 presence/absence 断言，`python3 -m unittest tests.test_install_local` 12 tests 全过。
- 来源: `docs/plans/2026-05-12-071-fix-baseline-md-install-plan.md` U1 pass。

## 适用场景

- 在现有子目录循环 install 脚本中增加新的 source-root 共享文件（如共享配置、基线规则、README 片段）。
- 调试"skill 运行时找不到 `../shared.md`"类报错时，首先检查 install 脚本是否只循环了子目录。
- Code review 时检查 install 脚本：每有一个 source-root 共享文件，就应有对应的 copy/check/uninstall 三元组与测试断言。

## 不适用场景

- 共享文件由多个工具共同管理（此时需要 marker 系统或幂等 merge，而不是无条件 copy/delete）。
- 共享文件是动态生成的，不应预先存在于 source 树（此类文件不应被 install 脚本管理）。

---
*沉淀日期: 2026-05-12 | 来源: `docs/plans/2026-05-12-071-fix-baseline-md-install-plan.md`*
