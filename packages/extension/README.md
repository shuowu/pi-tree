# @pi-tree/extension

Pi Package for AI-assisted book reading — skills, extensions, and ebook parsers.

## For Pi Terminal Users

```bash
pi install npm:@pi-tree/extension
```

This installs 11 reading skills and ebook tools into your Pi terminal.

## For Web App (packages/server)

```typescript
import { getParser } from "@pi-tree/extension/parsers";

const parser = getParser("book.epub");
const result = await parser.parse("/path/to/book.epub");
// result: { markdown, metadata, cover? }
```

## Skills

| Skill | Description |
|-------|-------------|
| add-book | Import new books: local files or repos |
| book-analysis | Generate structured analysis |
| book-context | Research author and historical context |
| book-notes | Personal reading notes |
| book-outline | Generate structural overviews |
| deep-dive | Deep analysis on a single topic |
| interactive-reading | Core reading experience |
| reading-list | Manage reading list and recommendations |
| reference-book | Searchable knowledge base across books |
| taste-profile | Build reading preference profile |
| trend-radar | Track trending books and topics |

## Parsers

In-process ebook parsers (no external CLI dependency):
- EPUB (via `epub2`)
- PDF (via `pdf-parse`)
- MOBI/AZW/AZW3 (via `@lingo-reader/mobi-parser`)
