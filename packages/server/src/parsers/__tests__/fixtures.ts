/**
 * Test fixture generators — creates minimal valid ebook files in-memory.
 * No real books used; these are tiny synthetic files for parser testing.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// EPUB — minimal valid epub: mimetype + container.xml + content.opf + chapters
// ---------------------------------------------------------------------------

const MIMETYPE = "application/epub+zip";

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>A test book for unit tests</dc:description>
    <dc:date>2024-01-01</dc:date>
    <dc:identifier id="uid">test-book-001</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

const CHAPTER1_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
<h1>Chapter 1: Introduction</h1>
<p>This is the first chapter of the test book.</p>
<p>It contains <strong>bold text</strong> and <em>italic text</em>.</p>
</body>
</html>`;

const CHAPTER2_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body>
<h1>Chapter 2: Conclusion</h1>
<p>This is the second chapter.</p>
<ul>
<li>Point one</li>
<li>Point two</li>
</ul>
</body>
</html>`;

/**
 * Create a minimal valid EPUB file using adm-zip (already in dep tree via epub2).
 */
export async function createTestEpub(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "test-book.epub");

  // adm-zip is CJS, already available via epub2's dependency tree
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip();

  // mimetype must be first and uncompressed (EPUB spec requirement)
  zip.addFile("mimetype", Buffer.from(MIMETYPE));
  zip.addFile("META-INF/container.xml", Buffer.from(CONTAINER_XML));
  zip.addFile("content.opf", Buffer.from(CONTENT_OPF));
  zip.addFile("chapter1.xhtml", Buffer.from(CHAPTER1_XHTML));
  zip.addFile("chapter2.xhtml", Buffer.from(CHAPTER2_XHTML));

  await writeFile(filePath, zip.toBuffer());
  return filePath;
}

// ---------------------------------------------------------------------------
// PDF — minimal valid PDF with one page, text content, and metadata
// ---------------------------------------------------------------------------

/**
 * Create a minimal valid PDF file. Returns the file path.
 */
export async function createTestPdf(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "test-book.pdf");

  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R
   /Resources << /Font << /F1 5 0 R >> >> >>
endobj

4 0 obj
<< /Length 64 >>
stream
BT
/F1 12 Tf
100 700 Td
(Hello World Test Content) Tj
ET
endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

6 0 obj
<< /Title (Test PDF Book) /Author (PDF Test Author) /CreationDate (D:20240101000000) >>
endobj

xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000062 00000 n 
0000000119 00000 n 
0000000277 00000 n 
0000000393 00000 n 
0000000466 00000 n 

trailer
<< /Size 7 /Root 1 0 R /Info 6 0 R >>
startxref
584
%%EOF`;

  await writeFile(filePath, content);
  return filePath;
}
