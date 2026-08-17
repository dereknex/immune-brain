# Maintainability Tooling Cost Metric Pack

This metric pack adds deterministic local checks for `plugin-eval` runs against
skills and plugins.

## Rubric

- `maintainability`: stable metadata, readable skill size, and recognizable
  operational structure.
- `tool-calling-quality`: concrete tool references, nearby usage boundaries, and
  safety language near risky command mentions.
- `token-cost`: estimated instruction tokens, inline fenced-code volume, and
  repeated instruction lines.

## Usage

```bash
plugin-eval analyze /path/to/skill --metric-pack ./manifest.json
plugin-eval analyze /path/to/plugin --metric-pack ./manifest.json
```

Run the commands from this directory or pass the absolute manifest path.

## Output

The pack emits only `checks[]` and `metrics[]`. It does not override the core
`plugin-eval` score or summary.
