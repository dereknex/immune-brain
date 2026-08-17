# Immune-Brain Pi Configuration

Pi 是 Immune-Brain 唯一支持的 code-agent host。本机配置固定在：

```text
~/.pi/agent/immune-brain/config.toml
```

配置属于本机偏好，不提交到 Git。旧的 `~/.immune-brain/` 不参与默认发现；需要保留旧配置时，显式移动到 Pi root，runtime 不猜测来源也不复制多份。

## Precedence

覆盖优先级由高到低：

1. CLI 的显式行为参数
2. `IMMUNE_BRAIN_AGENT_CONFIG`
3. `IMMUNE_BRAIN_CONFIG`
4. `~/.pi/agent/immune-brain/config.toml`
5. 内建默认值

Runtime 按相反顺序加载配置文件，使后加载的 `IMMUNE_BRAIN_AGENT_CONFIG` 覆盖前两层文件配置。

Runtime 不暴露 coding-agent ID 或 host root selector；配置来源固定为 Pi。

## Dev Insights

```toml
[dev_insights]
enabled = true
inbox_path = "~/.pi/agent/immune-brain/insights/workflow-improvement-inbox.md"
```

`inbox_path` 必须是绝对路径或 `~/` 路径。`IMM_DEV_INSIGHTS=1|0` 可覆盖 `enabled`；其他显式值会被拒绝。

## Output Language

```toml
[output_language]
default = "zh-CN"
```

该设置只影响面向用户的自然语言，不修改 machine contract、schema、路径、API 或代码 identifier。

## Subagent Activation

```toml
[subagent_activation]
default = "auto" # auto | explicit_only | disabled

[subagent_activation.hosts]
imm-code-review = "auto"
imm-ui-review = "auto"
imm-brainstorm = "auto"
imm-planner = "auto"
imm-work = "auto"
```

这里的 `hosts` 是工作流 review/coordination role，不是 code-agent host。优先级为：用户显式 solo、lens/subagent override、workflow role override、global default、repo default。

稳定 fallback reason：

- `explicit_required`
- `config_disabled`
- `host_authorization_required`
- `unavailable_environment`
- `trigger_not_hit`
- `unclear_boundary`
- `cost_scope_mismatch`
- `dispatch_failed`
- `child_timeout`

## Workflow Models

Pi 可使用任意已配置 model provider 的模型 ID。

```toml
[workflow]
model_preset = "balanced" # off | budget | balanced | quality | ensemble

[workflow_models]
planner = ["mid"]
planner_ensemble = ["fast", "mid", "strong"]
executor = ["inherit"]
qa_high_risk = ["strong"]

[workflow_model_options.planner]
reasoning_effort = "medium" # low | medium | high | xhigh | max
verbosity = "low"           # low | medium | high
```

`inherit` 表示不传 `model`，由当前 Pi session 继承。多模型 stage 会按解析后的 model ID 去重；少于两个不同模型时转为 single-model fallback。

## Model Tiers

```toml
[subagent_models]
fast   = "inherit"
mid    = "anthropic/claude-sonnet"
strong = "openai/gpt-5"
local  = "local/qwen"

[subagent_models.lens_overrides]
security = "google/gemini-pro"
api_contract = "inherit"
```

解析顺序：

1. lens override
2. activation plan 的 lens tier
3. candidate tier fallback
4. Pi session model inheritance

解析出的非 `inherit` model ID 作为 Pi `Agent` 的 `model` 参数传递。Provider 名称不等于宿主支持；Pi-only 不限制模型 provider。

## Related Contracts

- [`subagent-dispatch-protocol.md`](subagent-dispatch-protocol.md)
- [`automatic-subagent-activation-policy.md`](automatic-subagent-activation-policy.md)
