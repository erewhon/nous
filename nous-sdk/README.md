# nous-sdk

Python SDK for the [Nous](https://nous.page) notebook application.

## Install

```bash
pip install nous-sdk
```

## Quick Start

```python
from nous_sdk import Nous

app = Nous()  # connects to local daemon at localhost:7667

# List notebooks
for nb in app.list_notebooks():
    print(nb.name)

# Create a page
page = app.create_page("My Notebook", title="Meeting Notes", content="# Notes\n\nKey decisions...")

# Search
for result in app.search("project deadline"):
    print(f"{result.title} (score: {result.score:.2f})")

# Capture to inbox
app.capture_inbox("Remember to review the PR")

# Daily notes
note = app.get_daily_note("Journal", "2026-03-19")
```

## Configuration

The SDK auto-discovers the daemon at `http://127.0.0.1:7667`. Override with:

```python
app = Nous(base_url="http://myhost:7667")
```

Or set `NOUS_API_URL` environment variable.

## Requirements

- Python 3.10+
- Nous daemon running (`nous-cli daemon start`)
