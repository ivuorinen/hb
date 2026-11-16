#!/usr/bin/env bash
# PostToolUse hook (registered in .claude/settings.json): after Claude edits
# a file, apply Biome's safe fixes and formatting. If problems remain that
# Biome cannot fix, exit 2 so Claude Code shows them to Claude.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:?}"
if ! output=$(mise run lint-fix 2>&1); then
	printf '%s\n' "${output}" >&2
	exit 2
fi
