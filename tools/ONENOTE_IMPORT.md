# OneNote Backup Converter

Converts OneNote desktop backup `.one` files into `.nous.zip` archives that can be imported via **Import Notebook**.

## Prerequisites

- **Python 3.10+** (managed via `uv`)
- **Java 11+** (Tika runs a JVM server in the background)

## Setup

No manual install needed. `uv run` handles dependencies automatically:

```bash
cd tools
uv run onenote_to_nous.py --help
```

First run will create a `.venv` and install `tika` + `beautifulsoup4`. Tika will download its server JAR on first use (~80 MB, cached in `/tmp/tika-server`).

## Usage

### Convert a single .one file

```bash
uv run onenote_to_nous.py /path/to/Meals.one -o Meals.nous.zip
```

### Convert a directory of .one files

```bash
uv run onenote_to_nous.py /path/to/OneNote/Backups/Family/ -o Family.nous.zip
```

Files are grouped into folders by their parent directory name. For example:

```
Backups/Family/
  Recipes/
    Dinners.one      -> Folder: "Recipes"
    Desserts.one     -> Folder: "Recipes"
  Travel/
    Europe.one       -> Folder: "Travel"
  Notes.one          -> (root, no folder)
```

### Override the notebook name

```bash
uv run onenote_to_nous.py /path/to/Backups/ --name "Family Notebook" -o family.nous.zip
```

### Verbose output

```bash
uv run onenote_to_nous.py /path/to/Backups/ -o out.nous.zip --verbose
```

## Importing

1. Open the app
2. Use **Import Notebook** (or the import button in the sidebar)
3. Select the generated `.nous.zip` file
4. Pages appear with their extracted text content

## What gets converted

| OneNote content | Result |
|---|---|
| Text paragraphs | `paragraph` blocks (bold, italic, underline, links preserved) |
| Headings | `header` blocks (levels 1-6) |
| Bulleted lists | `list` blocks (unordered) |
| Numbered lists | `list` blocks (ordered) |
| Tables | `table` blocks |
| Embedded images (base64) | `image` blocks saved to assets/ |
| Other content | `paragraph` fallback with extracted text |

## Limitations

- **Text-focused** -- Tika extracts text and basic structure but not all rich formatting (font sizes, colors, highlights).
- **Images** -- Tika may or may not extract embedded images depending on the `.one` file structure. Base64 `<img>` tags in the XHTML output are decoded and saved; otherwise they are skipped with a warning.
- **Ink/handwriting** -- not extractable.
- **Requires Java** -- Tika spawns a JVM process. First run downloads the Tika server JAR.

## Troubleshooting

**"No content extracted"** -- The `.one` file may be empty or corrupted. Try opening it in OneNote first to verify it has content.

**Java not found** -- Install a JDK 11+ (e.g., `sudo apt install default-jdk` on Debian/Ubuntu, `brew install openjdk` on macOS).

**Tika server fails to start** -- Check that port 9998 is available and no firewall is blocking localhost connections. You can also set `TIKA_SERVER_JAR` to point to a local Tika server JAR.

## CLI Reference

```
usage: onenote_to_nous.py [-h] [-o OUTPUT] [--name NAME] [--verbose] path

Convert OneNote backup .one files to .nous.zip for import.

positional arguments:
  path                  Path to .one file or directory of .one files

options:
  -h, --help            show this help message and exit
  -o, --output OUTPUT   Output .nous.zip path (default: <name>.nous.zip)
  --name NAME           Notebook name (default: directory/file name)
  --verbose             Show detailed progress
```
