# Gradio streaming DOM churn repro

Streaming a long markdown answer into `gr.Chatbot` makes every update re-parse, re-sanitize and rebuild
the whole message. See `ISSUE.md`.

```sh
pip install gradio==6.29.0 playwright
playwright install chromium

python app.py            # terminal 1: the Chatbot on http://127.0.0.1:7860
python measure.py        # terminal 2: streams one answer in headless Chromium and prints DOM counters
```

`measure.py` samples CDP `Memory.getDOMCounters` every 250 ms without forcing GC, counts `DOMParser`
documents and the nodes inserted into the Chatbot, and forces a GC at the end to show the final node
count. Run it once against stock Gradio and once against a build with the fix to compare.
