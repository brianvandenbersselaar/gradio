"""Minimal repro: stream a long markdown answer into gr.Chatbot.

Run with `python app.py` and open http://127.0.0.1:7860. Every yield makes the Chatbot re-render
the bot message; watch the DOM node count in Chrome DevTools > Performance monitor.
"""

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
    for i in range(0, len(WORDS), 3):  # ~25 chunks per second, like a streaming LLM
        history[-1]["content"] += " ".join(WORDS[i : i + 3]) + " "
        time.sleep(0.04)
        yield history


with gr.Blocks() as demo:
    chatbot = gr.Chatbot(elem_id="chatbot")
    textbox = gr.Textbox(elem_id="textbox")
    textbox.submit(respond, [textbox, chatbot], chatbot)

if __name__ == "__main__":
    demo.queue().launch(server_port=7860)
