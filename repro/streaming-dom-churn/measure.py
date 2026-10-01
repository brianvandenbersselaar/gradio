"""Stream one answer in headless Chromium and report DOM churn.

Usage: python measure.py [url]   (default http://127.0.0.1:7860)
Needs `pip install playwright && playwright install chromium`.
"""

import json
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7860"

HOOKS = """() => {
  const count = (root) => { let n = 1; const w = document.createTreeWalker(root, NodeFilter.SHOW_ALL); while (w.nextNode()) n++; return n; };
  window.__probe = {domparser_documents: 0, nodes_inserted_into_chatbot: 0};
  const parse = DOMParser.prototype.parseFromString;
  DOMParser.prototype.parseFromString = function (...args) { window.__probe.domparser_documents++; return parse.apply(this, args); };
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) window.__probe.nodes_inserted_into_chatbot += count(n);
  }).observe(document.querySelector('#chatbot'), {childList: true, subtree: true});
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    cdp = page.context.new_cdp_session(page)
    cdp.send("HeapProfiler.enable")
    cdp.send("Performance.enable")

    def task_seconds() -> float:
        metrics = cdp.send("Performance.getMetrics")["metrics"]
        return next(m["value"] for m in metrics if m["name"] == "TaskDuration")

    def nodes() -> int:
        return cdp.send("Memory.getDOMCounters")["nodes"]

    page.goto(URL)
    page.wait_for_selector("#textbox textarea")
    page.evaluate(HOOKS)
    cdp.send("HeapProfiler.collectGarbage")
    baseline, task0 = nodes(), task_seconds()

    page.fill("#textbox textarea", "Explain it")
    page.press("#textbox textarea", "Enter")
    page.wait_for_selector("#chatbot .bot")
    samples, start, last_text, quiet = [], time.monotonic(), None, 0
    while quiet < 8:  # stream is done once the answer stops changing for 2s
        time.sleep(0.25)
        samples.append(nodes())
        text = page.evaluate(
            "[...document.querySelectorAll('#chatbot .bot')].pop()?.textContent.length"
        )
        quiet = quiet + 1 if text == last_text else 0
        last_text = text
    duration = time.monotonic() - start - 2

    busy = task_seconds() - task0
    probe = page.evaluate("window.__probe")
    cdp.send("HeapProfiler.collectGarbage")
    result = {
        "stream_seconds": round(duration, 1),
        "baseline_nodes": baseline,
        "peak_nodes": max(samples),
        "mean_nodes": round(statistics.mean(samples)),
        "nodes_after_forced_gc": nodes(),
        **probe,
        "main_thread_busy_pct": round(100 * busy / (duration + 2)),
    }
    print(json.dumps(result, indent=1))
    browser.close()
