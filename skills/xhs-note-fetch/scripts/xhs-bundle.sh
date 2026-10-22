#!/usr/bin/env bash
# Usage: xhs-bundle.sh <note url> <new bundle dir> [max_roots=200] [max_replies_per_root=50]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
[[ $# -ge 2 ]] || { echo "usage: $0 <note url> <new bundle dir> [max_roots] [max_replies]" >&2; exit 2; }
[[ ! -e $2 ]] || { echo "refusing to mix evidence: $2 already exists" >&2; exit 3; }
mkdir -p "$2/raw"
out=$(cd "$2" && pwd)
args=$(python3 -c 'import json,sys; print(json.dumps({"url": sys.argv[1], "out": sys.argv[2], "maxRoots": int(sys.argv[3]), "maxReplies": int(sys.argv[4])}))' "$1" "$out" "${3:-200}" "${4:-50}")
{ printf 'const ARGS = %s;\n' "$args"; cat "$here/xhs-bundle.mjs"; } | ego-browser nodejs 2> >(tee "$out/raw/ego-stderr.log" >&2)
