#!/usr/bin/env bash
# Run the Katt development server with proper Python/PyO3 environment

set -e

# Python 3.14 library path for PyO3
PYTHON_LIB_DIR="/home/linuxbrew/.linuxbrew/opt/python@3.14/lib"
PYTHON_PREFIX="/home/linuxbrew/.linuxbrew/opt/python@3.14"

# Set LD_LIBRARY_PATH so the Rust binary can find libpython
export LD_LIBRARY_PATH="${PYTHON_LIB_DIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# Tell PyO3 which Python to use
export PYO3_PYTHON="${PYTHON_PREFIX}/bin/python3.14"

# Activate the katt-py virtual environment for Python dependencies
VENV_DIR="$(dirname "$0")/katt-py/.venv"
if [ -d "$VENV_DIR" ]; then
    export VIRTUAL_ENV="$VENV_DIR"
    export PATH="$VENV_DIR/bin:$PATH"
    export PYTHONPATH="$(dirname "$0")/katt-py/src${PYTHONPATH:+:$PYTHONPATH}"
fi

echo "Starting Katt dev server..."
echo "  LD_LIBRARY_PATH: $LD_LIBRARY_PATH"
echo "  PYO3_PYTHON: $PYO3_PYTHON"
echo "  VIRTUAL_ENV: $VIRTUAL_ENV"
echo ""

# Run the Tauri dev server
exec pnpm dev
