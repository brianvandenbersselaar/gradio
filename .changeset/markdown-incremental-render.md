---
"@gradio/markdown-code": patch
"gradio": patch
---

fix:Render streamed markdown block by block, so a Chatbot or Markdown update only re-parses, re-sanitizes and rebuilds the blocks that changed instead of the whole message. Heading ids no longer change on every update.
