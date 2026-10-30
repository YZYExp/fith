# Fonts

| Mode | Behavior | Tradeoff |
| --- | --- | --- |
| `embed` | Keep SVG text and inline readable `@font-face` font data. | Text remains selectable; system fonts are not automatically embedded. Font loading and cross-origin access can affect the result. |
| `outline` | Convert glyphs to SVG paths when a usable font is available. | Converted text loses text selection and editing. Missing or unsupported fonts can fall back to SVG text. |
| `none` | Reference font families by name. | Rendering depends on fonts installed in the viewer's environment. |

Node outline mode resolves system fonts through `fontconfig` (`fc-match`). Install fontconfig and the needed fonts when using this path, particularly on Linux. Font formats and complex text shaping can limit outline fidelity; verify the actual output. Only embed or redistribute fonts and other assets you have permission to share.
