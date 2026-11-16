#!/usr/bin/env bash
# Downloads every URL in a list (one per line) into a folder named after the
# list, in the current directory: ./hb.sh bundle.txt → bundle/
# curl creates the folder itself (--create-dirs), so a missing list leaves
# nothing behind. xargs runs every URL, then exits non-zero if any failed.
set -euo pipefail

list=${1:?usage: hb.sh LIST.txt}
dir=$(basename "${list}" .txt)
xargs -n 1 curl -fLO -C - --create-dirs --output-dir "${dir}" <"${list}"
