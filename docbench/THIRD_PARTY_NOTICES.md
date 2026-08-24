# Third-party notices

## js-yaml

- Package: `js-yaml` 5.3.0
- Project: https://github.com/nodeca/js-yaml
- License: MIT

Used for YAML 1.2/1.1 parsing, validation and explicit formatting.

## PDF.js

- Package: `pdfjs-dist` 6.2.108
- Project: https://github.com/mozilla/pdf.js
- License: Apache-2.0

Used for local PDF parsing, rendering and outline/destination inspection. PDF
scripting and eval support are disabled by Doc Bench.

## @cantoo/pdf-lib

- Package: `@cantoo/pdf-lib` 2.9.1
- Project: https://github.com/cantoo-scribe/pdf-lib
- License: MIT

Used to rebuild bookmark trees after structural page operations.

## qpdf-run / qpdf

- Package: `qpdf-run` 0.2.1
- Project: https://github.com/RabbitHols/qpdf-run
- Wrapper license: MIT
- qpdf project: https://github.com/qpdf/qpdf
- qpdf license: Apache-2.0

Used to run qpdf locally in a Web Worker for content-preserving page selection,
merge, lossless structural optimization and linearization.

All browser assets are copied locally during the build. Production and portable
builds do not load these runtimes from a CDN.
