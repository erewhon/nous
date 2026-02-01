#!/usr/bin/env bash
# Setup Python environment for Nous development using uv.
# Source this file: source setup-python-env.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_VERSION="3.13"

# ---- Install Python via uv (idempotent) ----
echo "Ensuring Python ${PYTHON_VERSION} is installed via uv..."
uv python install "${PYTHON_VERSION}"

# ---- Locate the interpreter ----
PYO3_PYTHON="$(uv python find "${PYTHON_VERSION}")"
export PYO3_PYTHON
echo "  PYO3_PYTHON: ${PYO3_PYTHON}"

# ---- Derive libpython directory ----
LIBDIR="$("${PYO3_PYTHON}" -c "import sysconfig; print(sysconfig.get_config_var('LIBDIR'))")"

OS="$(uname -s)"
case "${OS}" in
    Linux*)
        export LD_LIBRARY_PATH="${LIBDIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        echo "  LD_LIBRARY_PATH: ${LD_LIBRARY_PATH}"
        ;;
    Darwin*)
        export DYLD_LIBRARY_PATH="${LIBDIR}${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
        echo "  DYLD_LIBRARY_PATH: ${DYLD_LIBRARY_PATH}"
        ;;
    *)
        echo "Warning: unsupported OS '${OS}', skipping library path setup"
        ;;
esac

# ---- Ensure python-bundle dir exists (Tauri expects it even in dev mode) ----
mkdir -p "${SCRIPT_DIR}/src-tauri/python-bundle"

# ---- Create / sync nous-py venv ----
echo "Syncing nous-py dependencies..."
uv sync --directory "${SCRIPT_DIR}/nous-py"

# ---- Export PYTHONPATH for nous-py source ----
export PYTHONPATH="${SCRIPT_DIR}/nous-py${PYTHONPATH:+:$PYTHONPATH}"
echo "  PYTHONPATH: ${PYTHONPATH}"

echo "Python environment ready."
