---
"@gradio/sanitize": patch
"@gradio/markdown-code": patch
"gradio": patch
---

fix:Sanitize markdown into DOM nodes that are inserted directly, instead of parsing every update into a throwaway document, serializing it and parsing it again.
