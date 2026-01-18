"""Jupyter cell execution module for Katt.

This module provides functionality to execute Python code cells
and capture their outputs in Jupyter notebook format.
"""

import sys
import io
import traceback
import base64
from typing import Any
from contextlib import redirect_stdout, redirect_stderr


def execute_cell(code: str, cell_index: int = 0) -> dict:
    """Execute a Python code cell and return outputs in Jupyter format.

    Args:
        code: The Python code to execute
        cell_index: The cell index (for display purposes)

    Returns:
        A dictionary containing:
        - success: Whether execution succeeded
        - outputs: List of Jupyter-format output objects
        - execution_count: The cell index + 1 (Jupyter convention)
    """
    outputs: list[dict] = []
    execution_count = cell_index + 1

    # Capture stdout and stderr
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    # Create execution namespace
    namespace: dict[str, Any] = {
        "__builtins__": __builtins__,
        "__name__": "__main__",
    }

    # Try to import common data science libraries if available
    try:
        import numpy as np
        namespace["np"] = np
        namespace["numpy"] = np
    except ImportError:
        pass

    try:
        import pandas as pd
        namespace["pd"] = pd
        namespace["pandas"] = pd
    except ImportError:
        pass

    try:
        import matplotlib
        matplotlib.use("Agg")  # Non-interactive backend
        import matplotlib.pyplot as plt
        namespace["plt"] = plt
        namespace["matplotlib"] = matplotlib
    except ImportError:
        plt = None

    success = True
    result_value = None

    try:
        # Redirect stdout/stderr and execute
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            # Try to compile as expression first (for return value)
            try:
                compiled = compile(code, "<cell>", "eval")
                result_value = eval(compiled, namespace)
            except SyntaxError:
                # Not an expression, execute as statements
                exec(code, namespace)

        # Capture stdout
        stdout_text = stdout_capture.getvalue()
        if stdout_text:
            outputs.append({
                "output_type": "stream",
                "name": "stdout",
                "text": stdout_text.splitlines(keepends=True),
            })

        # Capture stderr (non-error output)
        stderr_text = stderr_capture.getvalue()
        if stderr_text:
            outputs.append({
                "output_type": "stream",
                "name": "stderr",
                "text": stderr_text.splitlines(keepends=True),
            })

        # Handle matplotlib figures
        if plt is not None:
            figs = [plt.figure(i) for i in plt.get_fignums()]
            for fig in figs:
                buf = io.BytesIO()
                fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
                buf.seek(0)
                img_data = base64.b64encode(buf.read()).decode("utf-8")
                outputs.append({
                    "output_type": "display_data",
                    "data": {
                        "image/png": img_data,
                        "text/plain": ["<Figure>"],
                    },
                    "metadata": {},
                })
            plt.close("all")

        # Handle expression result
        if result_value is not None:
            result_repr = repr(result_value)
            data: dict[str, Any] = {
                "text/plain": result_repr.splitlines(keepends=True) or [result_repr],
            }

            # Check for rich display methods
            if hasattr(result_value, "_repr_html_"):
                try:
                    html = result_value._repr_html_()
                    if html:
                        data["text/html"] = html.splitlines(keepends=True)
                except Exception:
                    pass

            if hasattr(result_value, "_repr_png_"):
                try:
                    png_data = result_value._repr_png_()
                    if png_data:
                        data["image/png"] = base64.b64encode(png_data).decode("utf-8")
                except Exception:
                    pass

            outputs.append({
                "output_type": "execute_result",
                "execution_count": execution_count,
                "data": data,
                "metadata": {},
            })

    except Exception:
        success = False
        exc_type, exc_value, exc_tb = sys.exc_info()

        # Format traceback
        tb_lines = traceback.format_exception(exc_type, exc_value, exc_tb)

        outputs.append({
            "output_type": "error",
            "ename": exc_type.__name__ if exc_type else "Error",
            "evalue": str(exc_value),
            "traceback": tb_lines,
        })

    return {
        "success": success,
        "outputs": outputs,
        "execution_count": execution_count,
    }


def check_python_available() -> dict:
    """Check if Python execution is available and return environment info.

    Returns:
        A dictionary containing:
        - available: True
        - python_version: Python version string
        - packages: List of available packages
    """
    packages = []

    # Check for common data science packages
    try:
        import numpy
        packages.append(f"numpy {numpy.__version__}")
    except ImportError:
        pass

    try:
        import pandas
        packages.append(f"pandas {pandas.__version__}")
    except ImportError:
        pass

    try:
        import matplotlib
        packages.append(f"matplotlib {matplotlib.__version__}")
    except ImportError:
        pass

    try:
        import scipy
        packages.append(f"scipy {scipy.__version__}")
    except ImportError:
        pass

    try:
        import sklearn
        packages.append(f"scikit-learn {sklearn.__version__}")
    except ImportError:
        pass

    return {
        "available": True,
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "packages": packages,
    }
