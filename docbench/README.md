# Doc Bench — Document & PDF Studio

Local-first document toolbox in the Bench family. Files are processed in the
browser and are not uploaded.

The first slice covers TXT, Markdown, JSON, YAML/YML and XML editing, UTF-8 BOM
detection, line-ending detection/conversion, validation and explicit formatting.
PDF operations are staged next so page changes can be implemented with bookmark
preservation from the start.

## Local

```sh
cd docbench
npm ci
npm run dev
```

`npm run build` vendors browser dependencies and creates
`public/portable.html`.
