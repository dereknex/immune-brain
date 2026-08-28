#!/usr/bin/env bash
#
# Wizard — Trusted Publisher setup for immune-brain
# Walks user through npmjs.com Trusted Publisher + GitHub Actions permissions

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library — delightful, consistent UX. Identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=0
_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()
WRITTEN_SECRET=()
SKIPPED=()

_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later — it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser — visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser — visit it manually: $url"
}

pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name — gh not ready; set it later"
}

set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name — gh not ready; set it later"
}

finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES — Trusted Publisher for immune-brain
# ──────────────────────────────────────────────────────────────────────────

TOTAL_STAGES=4

banner "Trusted Publisher 发布配置 — immune-brain@2.8.3"

stage "检查当前状态"
say "已推送: fix(tracker)@61ccc29 + version packages@2.8.3，已合并到 main"
say "发布失败原因: npm 404 / OIDC 未配置 Trusted Publisher，或 workflow 无 PR 权限"
say "本向导将配置 npm Trusted Publisher 并重跑发布"
note "包名: immune-brain  当前版本: 2.8.3  已发布: 2.8.2"
if command -v gh >/dev/null 2>&1; then
  say "GitHub 仓库: $(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo dereknex/immune-brain)"
  say "npm 包: $(node -p "require('./package.json').name" 2>/dev/null)@$(node -p "require('./package.json').version" 2>/dev/null)"
fi
pause "确认后进入 npm 配置"

stage "npm — 配置 Trusted Publisher (OIDC)"
say "需要你在 npmjs.com 上为 immune-brain 添加 GitHub Actions 可信发布者"
open_url "https://www.npmjs.com/package/immune-brain/access"
step "登录 npm (账号需是 immune-brain 的 owner/maintainer)"
step "点击 Access → Trusted Publishers → Add Trusted Publisher → GitHub Actions"
step "填入："
say "    Organization / User:  dereknex"
say "    Repository:           immune-brain"
say "    Workflow:             release.yml"
say "    Environment:          留空"
step "保存后，回到此终端"
note "若页面提示已存在同名 publisher，说明之前已配置过，跳过即可"
pause "完成后按 Enter"

stage "GitHub — 允许 Actions 创建 PR"
say "之前 Release workflow 因无 PR 权限失败，已手动建 PR 合并，但下次仍需此权限"
open_url "https://github.com/dereknex/immune-brain/settings/actions"
step "在 Workflow permissions 选择:"
say "    ☑ Allow GitHub Actions to create and approve pull requests"
step "点击 Save"
pause "完成后按 Enter"

stage "重跑发布"
say "将重新触发 Release workflow 发布 2.8.3（OIDC，无需 NPM_TOKEN）"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if confirm "现在立即重跑最近的 Release workflow？"; then
    say "触发中..."
    gh run rerun 33138749711 --failed 2>&1 | head -20 || gh workflow run release.yml 2>&1 | head -20
    say "已触发，查看进度："
    say "  gh run list --limit 3"
    say "  gh run view --log-failed"
  else
    say "已跳过，可稍后手动执行："
    say "  gh run rerun 33138749711 --failed"
    say "  或: gh workflow run release.yml"
  fi
else
  say "请手动触发："
  say "  gh run rerun 33138749711 --failed"
  note "或在 GitHub → Actions → Release → Run workflow"
fi
say ""
say "发布成功后将自动："
say "  • npm 上出现 immune-brain@2.8.3"
say "  • GitHub 创建 Release + tag immune-brain-v2.8.3"

finish
