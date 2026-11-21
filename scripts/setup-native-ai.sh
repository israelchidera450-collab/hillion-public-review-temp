#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="d3c306d60007a714d820cb50c76086bc07aec055"
ENGINE_DIR="$ROOT_DIR/libs/llama.kt"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v cmake >/dev/null || { echo "CMake is required" >&2; exit 1; }
command -v glslc >/dev/null || { echo "glslc is required (install the glslc package)" >&2; exit 1; }

git -C "$ROOT_DIR" rev-parse --show-toplevel >/dev/null 2>&1 || {
  echo "Run this script from a Git working tree so the pinned engine can be added as a submodule." >&2
  exit 1
}
mkdir -p "$ROOT_DIR/libs"
if git -C "$ROOT_DIR" ls-files --stage -- libs/llama.kt | grep -q '^160000 '; then
  # Normal CI path after the submodule pointer has been committed.
  git -C "$ROOT_DIR" submodule update --init libs/llama.kt
elif [ ! -e "$ENGINE_DIR/.git" ]; then
  if [ -e "$ENGINE_DIR" ]; then
    rmdir "$ENGINE_DIR" 2>/dev/null || { echo "$ENGINE_DIR exists but is not an empty directory" >&2; exit 1; }
  fi
  git -C "$ROOT_DIR" submodule add https://github.com/tensai-app/llama.kt libs/llama.kt
fi

git -C "$ENGINE_DIR" fetch --no-tags origin "$PIN"
git -C "$ENGINE_DIR" checkout --detach "$PIN"
git -C "$ENGINE_DIR" submodule update --init --recursive

# llama.kt currently targets AGP 9 built-in Kotlin. HILLION remains on AGP 8.13,
# so apply the compatible Kotlin Android plugin explicitly to the engine module.
python3 - "$ENGINE_DIR/llama-kt/build.gradle.kts" <<'PYCODE'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
if 'org.jetbrains.kotlin.android' not in s:
    s = s.replace(
        'plugins { id("com.android.library") }',
        'plugins {\n    id("com.android.library")\n    id("org.jetbrains.kotlin.android")\n}',
        1
    )
p.write_text(s)
PYCODE

# Generate the pinned llama.cpp JNI sources and the OpenCL loader required by
# the upstream CMake target. The app itself requests CPU inference by default.
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$ANDROID_HOME" ]; then
  echo "ANDROID_HOME or ANDROID_SDK_ROOT must point to the Android SDK" >&2
  exit 1
fi
if [ -d "$ANDROID_HOME/cmake/3.31.6/bin" ]; then
  export PATH="$ANDROID_HOME/cmake/3.31.6/bin:$PATH"
fi
bash "$ENGINE_DIR/scripts/bootstrap.sh"
bash "$ENGINE_DIR/scripts/build-opencl.sh"

echo "Native AI source bootstrap completed at llama.kt $PIN"
