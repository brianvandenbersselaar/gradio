**Title:** Streaming into `gr.Chatbot` / `gr.Markdown` re-parses, re-sanitizes and rebuilds the whole message DOM on every update (O(n²) DOM churn)

### Describe the bug

While a message streams into `gr.Chatbot` (or `gr.Markdown`), every update makes `MarkdownCode` render the **entire** message again:

1. `marked.parse` over the whole text,
2. `sanitize()` parses the resulting HTML into a new `Document` with `DOMParser`, sanitizes it and serializes it back to a string,
3. `{@html}` parses that string a second time and replaces every node of the message.

So the DOM work per update grows with the length of the message, and the total work for one answer grows quadratically. Nothing is leaked: after a forced GC the node count returns to exactly what the final message needs. But during streaming the browser accumulates hundreds of thousands of garbage DOM nodes (plus one throwaway `Document` per update) faster than it collects them, and the main thread spends most of its time rebuilding nodes that did not change. In our production app (a Chatbot with long LLM answers) this showed up as renderer memory climbing past 1 GB during a single answer and ~80% dropped frames, with memory only coming back after the stream ended.

### Reproduction

Minimal app (`app.py`): a `gr.Chatbot` that streams a ~60 s markdown answer at ~25 chunks per second, like an LLM. Run `python app.py`, send any message, and watch *DOM Nodes* in Chrome DevTools > Performance monitor.

```python
import time
import gradio as gr

SECTION = (
    "## Section\n\n"
    "This is a **realistic** answer with `inline code`, a [link](https://www.gradio.app) and enough "
    "text to make the paragraph wrap over a few lines in the chat bubble.\n\n"
    "- first point with *emphasis*\n- second point\n- third point\n\n"
    "| column a | column b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n"
)
WORDS = (SECTION * 80).split(" ")


def respond(message, history):
    history = history + [
        {"role": "user", "content": message},
        {"role": "assistant", "content": ""},
    ]
    for i in range(0, len(WORDS), 3):
        history[-1]["content"] += " ".join(WORDS[i : i + 3]) + " "
        time.sleep(0.04)
        yield history


with gr.Blocks() as demo:
    chatbot = gr.Chatbot(elem_id="chatbot")
    textbox = gr.Textbox(elem_id="textbox")
    textbox.submit(respond, [textbox, chatbot], chatbot)

demo.queue().launch()
```

`measure.py` (link: https://github.com/brianvandenbersselaar/gradio/tree/fix/markdown-incremental-render/repro/streaming-dom-churn) drives the same app in headless Chromium through Playwright and reports DOM counters (CDP `Memory.getDOMCounters`, sampled every 250 ms without forcing GC), `DOMParser` calls, the nodes inserted into the Chatbot (MutationObserver) and main-thread time (CDP `Performance.getMetrics`). Two runs each, identical results:

| ~56 s stream | Gradio 6.29.0 | With the proposed change |
|---|---|---|
| Peak DOM nodes | 116k–117k | 6.5k |
| Mean DOM nodes during the stream | 34k | 4.0k |
| `DOMParser` documents created | 2,564 | 0 |
| Nodes inserted into the Chatbot | 3,218,288 | 20,928 |
| Main thread busy | 25–26% | 14–15% |
| Nodes after a forced GC (= final message) | 6,238 | 6,238 |

Of the nodes created per update, roughly half come from the sanitizer's `DOMParser` copy and half from `{@html}` rebuilding the message.

### Proposed solution

We implemented this on a fork as a reference: https://github.com/brianvandenbersselaar/gradio/tree/fix/markdown-incremental-render. Two code commits (plus one that documents the known limit below), in `js/markdown-code` and `js/sanitize`, no new public API:

**1. Render per top-level block** (`js/markdown-code`)
- On every update the text is lexed with `marked.lexer`; each top-level token is a block, cached by its source. Only blocks whose source changed go through marked's pipeline (hooks, `walkTokens` for async Prism highlighting, parser), the sanitizer and the DOM. While streaming that is the last block or two.
- The cache is cleared when reference-link definitions change (they alter earlier blocks), heading ids and LaTeX source are part of the cache key, and only the current blocks stay cached.
- A small `render_blocks` keeps the common prefix and suffix of the old and new block list in the DOM and replaces only the middle. Block nodes stay direct children of the `.md` span, so `.prose > *:first-child` and friends keep working.
- KaTeX and mermaid run only on newly inserted nodes, and renders are single-flight: updates that arrive during a render collapse into the latest text, so a slow device renders less often instead of falling behind.
- Tests: every prefix of a set of fixtures (headings, setext headings, lists, tables, highlighted code with blank lines, reference links, LaTeX, blockquotes, raw HTML) renders exactly like a full `marked.parse`; finished blocks keep the same DOM node objects (this test fails on the current code); cache size and single-flight behaviour.

**2. Sanitize into nodes instead of a string** (`js/sanitize`)
- New browser-only `sanitize_fragment(html): DocumentFragment` parses once into a `<template>` (inert like `DOMParser`, but no new document per call), sanitizes the fragment in place with Amuchina and returns it; `MarkdownCode` inserts those nodes directly. `sanitize()` keeps its string API (toasts, SSR) and is built on top of it.
- Because the sanitized nodes themselves are inserted, the serialize → re-parse round trip disappears, which is the precondition for mutation XSS.
- Template content belongs to a document that lives as long as the page, so the existing Amuchina patch (#13884) is extended to walk fragments directly instead of creating a `NodeIterator` there, which would keep every sanitized fragment alive.

### Side findings

- **Heading ids change on every update.** With `header_links=True`, `utils.ts` uses one module-level `GithubSlugger` that is never reset, so each re-render hands the same heading a new id (`h-section`, `h-section-1`, …) and anchor links break while streaming. Fixed in commit 1 by assigning ids per render from the text alone.
- **Known limit of block rendering.** The unit of reuse is a top-level token. One large token that keeps growing, typically a long "loose" list (items separated by blank lines, common in LLM output) or a long table, is still rebuilt as a whole on every update. In a real answer that was mostly one list, the main-thread time per update grew from ~46 to ~61 ms as the list grew, against 130–330 ms per update before. Reusing list items and table rows inside their container would remove this; we left it out to keep the change reviewable.

### System info

```
gradio 6.29.0, Python 3.12, macOS 26.7 (arm64)
Chrome 154.0.8037.93 (arm64) (DevTools traces of the production app) and Playwright headless Chromium 153.0.8010.12 (measurements above)
```

### Severity

I can work around it (throttling yields on the server reduces the number of updates), but long streamed answers remain heavy on low-end machines.
