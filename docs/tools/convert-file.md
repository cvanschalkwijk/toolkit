# `convert_file`

Convert an uploaded document to LLM-efficient Markdown.

## Purpose

**When to use:** you have a file (PDF, DOCX, PPTX, XLSX, HTML, image, …) and want to feed its content to an LLM. Raw PDF/DOCX bytes are ~10× the token count of Markdown and destroy context windows; a clean Markdown representation with preserved headings, tables, and lists is what most LLM workflows actually need.

**When NOT to use:**

- The input is a URL — use [`convert_url`](convert-url.md).
- The input is already plain text or Markdown — skip conversion entirely.
- You need per-paragraph chunks for RAG — pipe this output into [`chunk_semantic`](chunk-semantic.md).

## Signature

- **HTTP:** `POST /convert/file`
- **MCP:** `convert_file`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `file_base64` | string | yes | — | Base64-encoded file contents. |
| `filename` | string | yes | — | Original filename including extension. Used for format sniffing when `engine` is `auto`. |
| `engine` | `auto \| markitdown \| docling` | no | `auto` | Which engine to use. `auto` picks docling for PDF / DOCX / PPTX / XLSX, markitdown otherwise. |
| `format` | `markdown \| json \| html` | no | `markdown` | Output format. `json` and `html` are docling-only. |

## Output

```json
{
  "markdown": "# Annual Report 2025\n\n## Executive Summary\n\nRevenue grew 12%…",
  "engine_used": "docling",
  "format": "markdown",
  "source": { "filename": "report.pdf", "bytes": 48392 },
  "duration_ms": 3124
}
```

## Examples

### HTTP — convert a PDF

```bash
FILE_B64=$(base64 -w0 report.pdf)
curl -sS -X POST http://localhost:3000/convert/file \
  -H 'content-type: application/json' \
  -d "{\"file_base64\": \"$FILE_B64\", \"filename\": \"report.pdf\"}" \
  | jq '{engine_used, bytes: .source.bytes, preview: (.markdown | .[0:200])}'
```

Example output:

```json
{
  "engine_used": "docling",
  "bytes": 48392,
  "preview": "# Annual Report 2025\n\n## Executive Summary\n\nRevenue grew 12% year-over-year, driven by enterprise seat expansion and stable churn. Gross margin held at 73% despite a one-time COGS spike…"
}
```

### HTTP — convert a DOCX forcing markitdown

```bash
curl -sS -X POST http://localhost:3000/convert/file \
  -H 'content-type: application/json' \
  -d '{"file_base64":"'"$(base64 -w0 memo.docx)"'","filename":"memo.docx","engine":"markitdown"}' \
  | jq '.engine_used, .format'
```

### MCP — from an agent

From Claude Desktop, Cursor, or any MCP client:

> *Use the `convert_file` tool to convert `report.pdf` to markdown.*

The agent base64-encodes the file on its side and calls `convert_file`. The Markdown is returned as the tool result; the agent then reasons over it in-context.

## Notes & caveats

- **Max file size:** ~50 MB is the practical ceiling; docling on large PDFs can eat several GB of RAM.
- **First-call warmup:** docling lazily loads PyTorch models on the first PDF/DOCX conversion in a fresh container — budget 3–5 s for cold start.
- **OCR:** not enabled by default. Scanned PDFs will return empty or garbled Markdown through both engines. Add a pre-step to OCR the image → PDF before converting, or pass `engine=markitdown` with image-content extras to use markitdown's OCR pipeline.
- **Non-Markdown output:** `format=json` works only with `engine=docling`. `format=html` likewise. Requesting json with markitdown will silently return Markdown.
- **Auto-routing table:**

  | Extension | `auto` picks |
  |---|---|
  | `pdf`, `docx`, `pptx`, `xlsx` | docling |
  | everything else | markitdown |

- **Errors:**
  - `415 unsupported input format` — neither engine could detect the format from the bytes + filename.
  - `422 conversion failed` — engine matched but threw during conversion (corrupt file, unsupported subtype, etc.).
  - `501` — the sidecar was built without `[convert]` extras. Rebuild with `pip install 'toolkit-py[convert]'`.

## See also

- [`convert_url`](convert-url.md) — same behavior for a URL input.
- [markitdown upstream](https://github.com/microsoft/markitdown)
- [docling upstream](https://github.com/docling-project/docling)
