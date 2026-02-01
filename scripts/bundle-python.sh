#!/usr/bin/env bash
# Bundle Python interpreter, stdlib, site-packages, and nous-py source
# into src-tauri/python-bundle/ for inclusion in the release binary.
#
# Run after `source setup-python-env.sh` so uv + Python 3.13 are available.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUNDLE_DIR="${PROJECT_ROOT}/src-tauri/python-bundle"
PYTHON_VERSION="3.13"

echo "==> Bundling Python for release..."

# ---- Locate interpreter and paths ----
PYTHON="$(uv python find "${PYTHON_VERSION}")"
echo "  Python interpreter: ${PYTHON}"

LIBDIR="$("${PYTHON}" -c "import sysconfig; print(sysconfig.get_config_var('LIBDIR'))")"
STDLIB_DIR="$("${PYTHON}" -c "import sysconfig; print(sysconfig.get_path('stdlib'))")"
DYNLOAD_DIR="$("${PYTHON}" -c "import sysconfig; print(sysconfig.get_path('platstdlib'))")/lib-dynload"
echo "  LIBDIR:      ${LIBDIR}"
echo "  stdlib:      ${STDLIB_DIR}"
echo "  lib-dynload: ${DYNLOAD_DIR}"

# ---- Clean previous bundle ----
rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}/lib/python${PYTHON_VERSION}"

# ---- 1. Copy libpython shared library ----
OS="$(uname -s)"
case "${OS}" in
    Linux*)
        # Find the shared library (e.g. libpython3.13.so.1.0)
        LIBPYTHON="$(find "${LIBDIR}" -maxdepth 1 -name "libpython${PYTHON_VERSION}*.so*" -type f | head -1)"
        if [ -z "${LIBPYTHON}" ]; then
            echo "ERROR: Could not find libpython shared library in ${LIBDIR}" >&2
            exit 1
        fi
        echo "  Copying ${LIBPYTHON}..."
        cp -L "${LIBPYTHON}" "${BUNDLE_DIR}/lib/"
        # Create expected symlinks (skip if basename already matches target)
        BASENAME="$(basename "${LIBPYTHON}")"
        cd "${BUNDLE_DIR}/lib"
        if [ "${BASENAME}" != "libpython${PYTHON_VERSION}.so.1.0" ]; then
            ln -sf "${BASENAME}" "libpython${PYTHON_VERSION}.so.1.0"
        fi
        ln -sf "libpython${PYTHON_VERSION}.so.1.0" "libpython${PYTHON_VERSION}.so"
        cd "${PROJECT_ROOT}"
        ;;
    Darwin*)
        LIBPYTHON="$(find "${LIBDIR}" -maxdepth 1 -name "libpython${PYTHON_VERSION}*.dylib" -type f | head -1)"
        if [ -z "${LIBPYTHON}" ]; then
            echo "ERROR: Could not find libpython shared library in ${LIBDIR}" >&2
            exit 1
        fi
        echo "  Copying ${LIBPYTHON}..."
        cp -L "${LIBPYTHON}" "${BUNDLE_DIR}/lib/"
        BASENAME="$(basename "${LIBPYTHON}")"
        # Fix install name so rpath-based loading works
        install_name_tool -id "@rpath/libpython${PYTHON_VERSION}.dylib" "${BUNDLE_DIR}/lib/${BASENAME}"
        cd "${BUNDLE_DIR}/lib"
        ln -sf "${BASENAME}" "libpython${PYTHON_VERSION}.dylib"
        cd "${PROJECT_ROOT}"
        ;;
    *)
        echo "ERROR: Unsupported OS '${OS}'" >&2
        exit 1
        ;;
esac

# ---- 2. Copy stdlib (pruned) ----
echo "  Copying stdlib..."
rsync -a --exclude='__pycache__' \
    --exclude='test/' --exclude='tests/' \
    --exclude='tkinter/' --exclude='idlelib/' \
    --exclude='ensurepip/' --exclude='turtledemo/' \
    --exclude='turtle.py' \
    "${STDLIB_DIR}/" "${BUNDLE_DIR}/lib/python${PYTHON_VERSION}/"

# ---- 3. Copy lib-dynload (compiled stdlib modules) ----
if [ -d "${DYNLOAD_DIR}" ]; then
    echo "  Copying lib-dynload..."
    mkdir -p "${BUNDLE_DIR}/lib/python${PYTHON_VERSION}/lib-dynload"
    cp -a "${DYNLOAD_DIR}/"* "${BUNDLE_DIR}/lib/python${PYTHON_VERSION}/lib-dynload/"
fi

# ---- 4. Install nous-py dependencies into bundle site-packages ----
echo "  Installing nous-py dependencies into bundle..."
SITE_PKG="${BUNDLE_DIR}/lib/python${PYTHON_VERSION}/site-packages"
mkdir -p "${SITE_PKG}"

# Create a temp venv for clean dependency installation
TMPVENV="$(mktemp -d)"
uv venv --python "${PYTHON}" "${TMPVENV}/venv"
uv pip install --python "${TMPVENV}/venv/bin/python" \
    --target "${SITE_PKG}" \
    -r <(uv pip compile "${PROJECT_ROOT}/nous-py/pyproject.toml" --python "${PYTHON}" 2>/dev/null || \
         "${TMPVENV}/venv/bin/python" -c "
import tomllib, pathlib
data = tomllib.loads(pathlib.Path('${PROJECT_ROOT}/nous-py/pyproject.toml').read_text())
for dep in data['project']['dependencies']:
    print(dep)
")
rm -rf "${TMPVENV}"

# ---- 5. Copy nous-py source ----
echo "  Copying nous-py source..."
mkdir -p "${BUNDLE_DIR}/nous-py"
cp -a "${PROJECT_ROOT}/nous-py/nous_ai" "${BUNDLE_DIR}/nous-py/"

# ---- Summary ----
echo ""
echo "==> Bundle created at ${BUNDLE_DIR}"
echo "    Contents:"
du -sh "${BUNDLE_DIR}/lib/"* 2>/dev/null | sed 's/^/      /'
du -sh "${BUNDLE_DIR}/nous-py" 2>/dev/null | sed 's/^/      /'
echo ""
echo "==> Done."
