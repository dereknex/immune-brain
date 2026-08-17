#!/bin/sh
set -eu

# Retire stale Immune-Brain managed-copy global wrappers after the CLI rewrite.
# Default: dry-run report only. Use --apply to rename eligible wrappers to .retired.
# This script is self-contained and can be copied to any machine that still has
# old ~/.local/bin/imm-* wrappers from the legacy managed-copy installer.

BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
APPLY=false

usage() {
  echo "Usage: $0 [--apply] [--bin-dir <dir>]"
  echo "  Default is dry-run: report eligible stale wrappers without renaming."
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=true
      shift
      ;;
    --bin-dir)
      BIN_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

eligible=0
applied=0
ineligible=0

for wrapper in "$BIN_DIR"/imm-*; do
  [ -e "$wrapper" ] || continue
  case "$wrapper" in
    *.retired) continue ;;
  esac

  name=$(basename "$wrapper")
  retired="$wrapper.retired"

  if [ -L "$wrapper" ]; then
    echo "ineligible: $name (symlink, not a managed-copy file)"
    ineligible=$((ineligible+1))
    continue
  fi

  if [ ! -f "$wrapper" ]; then
    echo "ineligible: $name (not a regular file)"
    ineligible=$((ineligible+1))
    continue
  fi

  # Same markers used by plugins/immune-brain/runtime/imm_core.ts
  if ! grep -q "imm-install-mode: copy" "$wrapper" || \
     ! grep -q "imm-install-family: agent-skills" "$wrapper" || \
     ! grep -q "imm-install-runtime-root:" "$wrapper"; then
    echo "ineligible: $name (lacks Immune-Brain managed-copy markers)"
    ineligible=$((ineligible+1))
    continue
  fi

  # New plugin-local wrappers expose --sync; do not retire them.
  if grep -q -- "--sync" "$wrapper"; then
    echo "ineligible: $name (already exposes --sync, likely current)"
    ineligible=$((ineligible+1))
    continue
  fi

  echo "eligible: $name"
  eligible=$((eligible+1))

  if [ "$APPLY" = true ]; then
    if [ -e "$retired" ]; then
      echo "  skipped: $name.retired already exists"
    else
      mv "$wrapper" "$retired"
      echo "  retired: $name -> $name.retired"
      applied=$((applied+1))
    fi
  fi
done

echo "Summary: eligible=$eligible, applied=$applied, ineligible=$ineligible"
if [ "$eligible" -gt 0 ] && [ "$APPLY" = false ]; then
  echo "Rerun with --apply to rename the eligible wrappers."
fi

echo "Review before removing old runtime root: $HOME/.immune-brain/runtime/agent-skills"
