---
name: add-book
description: "Add a new book to the library: copy from source, convert to markdown, create folder structure, auto-generate outline and summary. Use when the user wants to add, import, or ingest a new book into their library. Triggers: add this book, import book, new book, add to library, I downloaded a book, ingest this, pull book from github."
---

# Add Book to Library

Import a new ebook into the library with proper folder structure, conversion to markdown, and optional initial analysis.

## When to Use

- User says "add this book" or "import this book"
- User shares a file path to an ebook
- User says "I downloaded a book" or "new book"
- User asks to ingest or import a file into the library

## Default Source

Books come from **`~/Downloads/`** by default. If the user provides a path, use that instead.

## Supported Sources

1. **Local files** — path to an ebook file (PDF, EPUB, MOBI, AZW3, FB2, HTML, TXT)
2. **GitHub repositories** — URL to a GitHub repo containing a book as markdown files

## Supported Formats

PDF, EPUB, MOBI, AZW3, FB2, HTML, TXT, **GitHub repo (markdown)**

## Workflow

### 1. Identify the Book Source

Determine the source type:

- **GitHub URL** — if the input matches `https://github.com/<owner>/<repo>` → follow the **GitHub Repo Workflow** below
- **Local path** — if the user provides a file path, use it
- **Filename only** — look in `~/Downloads/`
- **Title or partial name** — search `~/Downloads/` for matches:
```bash
ls ~/Downloads/*.{epub,pdf,mobi,azw3,fb2,html,txt} 2>/dev/null | grep -i "<query>"
```
- If ambiguous, list matches and ask the user to confirm

---

## GitHub Repo Workflow

For books hosted as markdown in GitHub repositories (e.g., `https://github.com/lamb/a-philosophy-of-software-design`).

### G1. Clone the Repo

```bash
BOOK_DIR="library/<Title>_<AuthorLastName>_<Year>"
mkdir -p "$BOOK_DIR"/{book,markdown,notes,analysis}

git clone --depth 1 "<github_url>.git" "$BOOK_DIR/book/repo"
```

### G2. Discover Book Content

Explore the repo structure to find the book's content:

```bash
# List top-level structure
find "$BOOK_DIR/book/repo" -maxdepth 2 -type f -name "*.md" | head -40

# Check common locations: docs/, chapters/, manuscript/, src/, book/, or root
ls "$BOOK_DIR/book/repo/"
```

Patterns to recognize:
- **VitePress/Docs site** — chapters in `docs/*.md` (e.g., `docs/introduction.md`, `docs/chapter-1.md`)
- **Flat markdown** — all `.md` files at repo root
- **Subdirectory** — book in a subfolder like `manuscript/` or `chapters/`
- **Single file** — entire book in one `.md` file

### G3. Assemble the Markdown

Combine the chapter files into a single markdown file in the correct reading order:

1. **Identify chapter order** — check for:
   - A table of contents file (`toc.md`, `SUMMARY.md`, `index.md`, `README.md`)
   - Numbered filenames (`01-intro.md`, `chapter-01.md`)
   - Alphabetical/lexical sort if filenames are naturally ordered
   - VitePress sidebar config (`.vitepress/config.js` → `sidebar` section)

2. **Concatenate chapters** in order:
```bash
# Example: ordered chapters from docs/ folder
cat "$BOOK_DIR/book/repo/docs/preface.md" \
    "$BOOK_DIR/book/repo/docs/introduction.md" \
    $(ls "$BOOK_DIR/book/repo/docs/"chapter-*.md | sort) \
    "$BOOK_DIR/book/repo/docs/conclusion.md" \
    > "$BOOK_DIR/markdown/<Title>.md"
```

   Insert a separator between chapters for readability:
```bash
# More robust: use a loop with separators
for file in <ordered_files>; do
  echo -e "\n\n---\n\n"
  cat "$file"
done > "$BOOK_DIR/markdown/<Title>.md"
```

3. **If there's a single large `.md` file**, just copy it:
```bash
cp "$BOOK_DIR/book/repo/path/to/book.md" "$BOOK_DIR/markdown/<Title>.md"
```

### G4. Extract Metadata

Extract metadata from the repo and content:

- **Title & Author** — from `README.md`, `package.json`, `title` metadata, or GitHub repo description
- **Year** — from copyright page, git log (`git -C "$BOOK_DIR/book/repo" log --reverse --format=%ci | head -1`), or file content

```bash
# Check README for title/author
head -50 "$BOOK_DIR/book/repo/README.md"

# Check package.json for title/description
cat "$BOOK_DIR/book/repo/package.json" 2>/dev/null | jq '{name, description, author}'

# Search for copyright year in the assembled markdown
grep -i "copyright\|©\|published" "$BOOK_DIR/markdown/<Title>.md" | head -5
```

Then rename the directory if needed to match `<Title>_<AuthorLastName>_<Year>`.

### G5. Clean Up Repo Clone

After assembling the markdown, remove the git repo to save space:
```bash
rm -rf "$BOOK_DIR/book/repo/.git"
```

Keep the original files in `book/repo/` as reference (they serve as the "original ebook"). If disk space is a concern, offer to remove the full repo and keep only the assembled markdown.

### G6. Continue with Standard Workflow

Skip to **Step 4 (Convert to Markdown)** — the markdown is already assembled, so verification is the main step.

Then continue with **Step 5 (Verify)** → **Step 6 (Auto-Generate Outline)** → **Step 7 (Auto-Generate Summary)** → **Step 8 (Report)**.

---

## Local File Workflow

### 2. Extract Metadata (Local Files)

From the filename, extract:
- **Title** — the book's title
- **Author** — author last name
- **Year** — publication year (if present; otherwise extract from the file after conversion)

Common filename patterns:
```
The_Title_-_Author_Name.epub
Title_AuthorLastName_Year.pdf
AuthorLastName - Title (Year).mobi
```

If the year is not in the filename, extract it from the book's copyright page after conversion (grep for copyright/published year).

### 3. Create Library Structure

```
library/<Title>_<AuthorLastName>_<Year>/
├── book/            — original ebook file (or cloned repo)
├── markdown/        — converted markdown (auto-generated)
├── notes/           — user notes (created empty)
└── analysis/        — AI analysis (created empty)
```

```bash
BOOK_DIR="library/<Title>_<AuthorLastName>_<Year>"
mkdir -p "$BOOK_DIR"/{book,markdown,notes,analysis}
```

Copy the source file:
```bash
cp "<source_path>" "$BOOK_DIR/book/"
```

### 3b. Fetch or Extract Cover Image

Search for or extract a cover image for the book and save it as `cover.jpg` (or `.png`/`.webp`) in the root of the book's folder: `library/<Title>_<AuthorLastName>_<Year>/cover.jpg`.

#### Method A: Extract from EPUB (if source is EPUB)
Use calibre's `ebook-meta` if available to extract the embedded cover:
```bash
ebook-meta "$BOOK_DIR/book/<filename>" --get-cover="$BOOK_DIR/cover.jpg"
```

#### Method B: Extract from PDF (if source is PDF)
Render the first page of the PDF as a JPEG using `pdftoppm`:
```bash
pdftoppm -jpeg -f 1 -l 1 -r 150 "$BOOK_DIR/book/<filename>" "$BOOK_DIR/cover-raw"
mv "$BOOK_DIR/cover-raw-1.jpg" "$BOOK_DIR/cover.jpg"
```

#### Method C: Fetch from Open Library API (fallback/GitHub repos)
Query the Open Library Search API using the Title and Author, extract the cover ID, and download the cover image:
```bash
# 1. Search for book cover ID
COVER_ID=$(curl -s "https://openlibrary.org/search.json?title=$(echo "<Title>" | jq -sRr @uri)&author=$(echo "<Author>" | jq -sRr @uri)" | jq '.docs[0].cover_i')

# 2. Download the cover if ID exists
if [ "$COVER_ID" != "null" ] && [ -n "$COVER_ID" ]; then
  curl -s "https://covers.openlibrary.org/b/id/${COVER_ID}-L.jpg" -o "$BOOK_DIR/cover.jpg"
fi
```

### 4. Convert to Markdown

Use `ebook_convert` to convert the book:
```
ebook_convert input_path="$BOOK_DIR/book/<filename>" output_path="$BOOK_DIR/markdown/<Title>.md"
```

If `ebook_convert` fails, try with `local: true`.

If that also fails, try pandoc directly:
```bash
pandoc "$BOOK_DIR/book/<filename>" -t markdown --wrap=none -o "$BOOK_DIR/markdown/<Title>.md"
```

If the year was unknown, extract it now:
```bash
grep -i "copyright\|published\|©" "$BOOK_DIR/markdown/<Title>.md" | head -5
```
Then rename the directory with the correct year.

### 5. Verify

Confirm the conversion succeeded:
```bash
wc -l "$BOOK_DIR/markdown/<Title>.md"
```

A successful conversion should produce a substantial file (typically 2,000+ lines for a full book).

### 6. Auto-Generate Outline

After successful conversion, automatically generate the book outline by following the **`book-outline`** skill workflow at **Standard** depth level.

- Input: `$BOOK_DIR/markdown/<Title>.md`
- Output: `$BOOK_DIR/analysis/outline.md` + `$BOOK_DIR/analysis/toc.json`

Load and follow the `book-outline` skill instructions for the full workflow (heading scan, key passages, template, etc.).

### 7. Auto-Generate Summary

After the outline, automatically generate a concise book summary by following the **`book-analysis`** skill workflow for a `summary.md`.

- Input: `$BOOK_DIR/markdown/<Title>.md`
- Output: `$BOOK_DIR/analysis/summary.md`

Load and follow the `book-analysis` skill instructions for the full summary workflow (reading strategy, format, etc.).

### 8. Report & Offer Next Steps

Tell the user:
- What was added (title, author, year)
- Where it lives in the library
- How many lines were converted
- That outline and summary were auto-generated

Then offer next steps:
- **Start reading** — `interactive-reading` skill
- **Deep analysis** — `book-analysis` skill (key ideas, quotes, etc.)
- **Add to reading list** — `reading-list` skill
- **Update taste profile** — `taste-profile` skill

Example response:
> ✅ Added **The Infinity Machine** by Sebastian Mallaby (2026)
> `library/The_Infinity_Machine_Mallaby_2026/` — 8,120 lines converted
> 📋 Outline generated → `analysis/outline.md`
> 📝 Summary generated → `analysis/summary.md`
>
> What next? Start reading / Deep analysis / Add to reading list / Update taste profile

## Folder Naming Rules

- Use PascalCase for title words: `The_Infinity_Machine`
- Author: last name only, PascalCase: `Mallaby`
- Year: 4 digits: `2026`
- Separate with underscores: `<Title>_<AuthorLastName>_<Year>`
- No spaces or special characters

## Error Handling

- **File not found**: Search `~/Downloads/` for similar names and suggest matches
- **Conversion fails**: Try all fallback methods (ebook_convert → ebook_convert local → pandoc)
- **Year missing**: Extract from copyright page after conversion; if still unknown, use `Unknown` and update later
- **Duplicate**: Check if `library/` already has a folder for this book; if so, ask whether to replace or skip
- **GitHub clone fails**: Check if `git` is available, verify the URL is correct, and ensure network access. Try `wget`/`curl` to download a zip archive as fallback: `curl -L https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.zip -o repo.zip`
- **Chapter order unclear**: Read `README.md` and any `SUMMARY.md`/`toc.md` first. If still unclear, list all `.md` files and present them to the user for confirmation of order

## Tips

- Default to doing everything in one go: copy → convert → outline → summary
- The outline and summary are auto-generated at **Standard** depth — the user can request deeper analysis later
- Keep the original filename in `book/` unchanged (don't rename the source file)
- For the markdown output, use a clean title-based name: `<Title>.md`
- If outline or summary generation fails, continue anyway and note the failure in the report — don't block the user
- For very large books (>15,000 lines), you may read strategically (intro + conclusion + sample chapters) rather than scanning everything for the initial summary
