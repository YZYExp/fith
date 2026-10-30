# Fonts

Status: partly implemented (resolver), rest proposed.

## Problem
An editable SVG (Figma, Illustrator) must keep text as `<text>`. Those tools ignore `@font-face` embedded in the SVG, so what matters is the family name; embedding only helps browsers. Fonts are also the main source of size (whole files as base64) and of failure (frames without network cannot fetch them).

## Contract
- `fontMode: 'embed'` carries the faces the text uses; `'none'` references families by name only; `'outline'` turns glyphs into paths (not editable as text).
- `fonts` supplies the faces instead of reading the document: a list, or a `FontResolver`, called once per used family/weight/style with `chars`, every distinct character set in it. The host can fetch the file and cut a subset. A resolver that throws or answers `null` leaves that family referenced by name; the `CaptureReport` says so.

## Open
- Bundle a subsetter or leave it to hosts (current: hosts).
- Report which families have no installed or embedded font on the viewer's machine.
- `outline` in the browser from the same bytes, without fontconfig.
