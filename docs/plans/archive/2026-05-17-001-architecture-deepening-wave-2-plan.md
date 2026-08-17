# Iteration Plan

## Task
- Summary: Architecture Deepening Wave 2: 消除 `imm_core` 的倒置依赖，清理残余的门面模块，并归口 `activation_plan.py`。
- Origin: Architecture Exploration candidate selection based on `docs/adr/0001-dedicated-architecture-explorer-skill.md` and `CONTEXT.md`.
- Research:
  1. `imm_core/telemetry.py` 和 `imm_core/current_iteration_state.py` 当前使用 `importlib.util` 动态加载 `.imm/imm-telemetry.py` 和 `.imm/imm-plan.py`，存在反向依赖。
  2. `.imm/current_iteration_state.py` 和 `.imm/state_machine.py` 是遗留的中间路由模块，只是将 `imm_core` 中的实现向外重导出。
  3. `.imm/activation_plan.py` 是核心路由文件，理应属于 `imm_core`。
- Decisions: 按照 Architecture Exploration 确定的候选方案执行。
- Assumptions: none

## Steps

### Step 1
- Step ID: U1
- Result: 提取依赖加载逻辑至 imm_core 并修改 CLI 脚本以消除反向动态导入 importlib.util。
- Verification: 运行 `rg "importlib\.util" .imm/imm_core/` 且不再匹配到向外部加载的调用，运行测试 `python3 -m unittest discover -s tests` 必须全部通过。
- Depends on: none

### Step 2
- Step ID: U2
- Result: 移除遗留的中间路由模块 current_iteration_state.py 和 state_machine.py 以迫使外部脚本直接引用 imm_core。
- Verification: 运行 `ls -l .imm/current_iteration_state.py .imm/state_machine.py` 报错提示文件不存在，且 `python3 -m unittest discover -s tests` 成功执行。
- Depends on: 1

### Step 3
- Step ID: U3
- Result: 迁移 activation_plan.py 至 imm_core 目录并更新所有相关的导入路径。
- Verification: 运行 `ls -l .imm/imm_core/activation_plan.py` 验证文件存在，运行 `python3 .imm/imm_core/activation_plan.py --help` 不报错，且运行 `python3 -m unittest discover -s tests` 全部通过。
- Depends on: 2
