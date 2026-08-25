# Doc Bench — Document & PDF Studio

Local-first document toolbox in the Bench family. Files are processed in the
browser and are not uploaded.

Documents cover TXT, Markdown, JSON, YAML/YML and XML editing, UTF-8 BOM and
line-ending handling, validation and explicit formatting. Markdown gets a safe
rendered preview, JSON/YAML/XML get collapsible tree views, and supported
browsers can save changes directly back to a chosen local file. Download remains
available as the portable fallback.

PDF tools cover local preview, merge, page deletion/reordering, single-page
extraction, split-to-ZIP, bookmark editing, lossless optimization, optional lossy
image recompression and Fast Web View. Bookmark trees are remapped to surviving
pages, rebuilt and verified before every PDF download.

## Local

```sh
cd docbench
npm ci
npm run dev
```

`npm run build` vendors browser dependencies and creates
`public/portable.html`.
