import { afterEach, describe, expect, test } from "vitest";
import { render_blocks, type RenderedBlock } from "./render";

const to_fragment = (html: string): DocumentFragment => {
	const template = document.createElement("template");
	template.innerHTML = html;
	return template.content;
};

const attached_span = (): HTMLSpanElement =>
	document.body.appendChild(document.createElement("span"));

const block = (key: string, html = `<p>${key}</p>\n`) => ({ key, html });

function render(el: HTMLElement, previous: RenderedBlock[], keys: string[]) {
	return render_blocks(
		el,
		previous,
		keys.map((k) => block(k)),
		to_fragment
	);
}

describe("render_blocks", () => {
	afterEach(() => document.body.replaceChildren());

	test("renders blocks as direct children of the element, without wrappers", () => {
		const el = attached_span();
		render(el, [], ["een", "twee"]);

		expect(el.innerHTML).toBe("<p>een</p>\n<p>twee</p>\n");
	});

	test("keeps the DOM nodes of unchanged blocks when a later block changes", () => {
		const el = attached_span();
		const first = render(el, [], ["een", "twee"]);
		const een = el.querySelector("p")!;

		const second = render(el, first.rendered, ["een", "twee drie"]);

		expect(el.querySelector("p")).toBe(een);
		expect(een.isConnected).toBe(true);
		expect(el.innerHTML).toBe("<p>een</p>\n<p>twee drie</p>\n");
		expect(
			second.inserted.filter((n) => n.nodeType === Node.ELEMENT_NODE)
		).toHaveLength(1);
	});

	test("keeps blocks after an edit in the middle", () => {
		const el = attached_span();
		const first = render(el, [], ["een", "twee", "drie"]);
		const drie = el.querySelectorAll("p")[2];

		render(el, first.rendered, ["een", "TWEE", "drie"]);

		expect(el.querySelectorAll("p")[2]).toBe(drie);
		expect(el.innerHTML).toBe("<p>een</p>\n<p>TWEE</p>\n<p>drie</p>\n");
	});

	test("handles removed, empty and duplicate blocks", () => {
		const el = attached_span();
		let state = render(el, [], ["een", "een", "twee"]).rendered;

		state = render_blocks(
			el,
			state,
			[block("een"), block("leeg", ""), block("een")],
			to_fragment
		).rendered;
		expect(el.innerHTML).toBe("<p>een</p>\n<p>een</p>\n");

		state = render(el, state, []).rendered;
		expect(el.innerHTML).toBe("");
		expect(state).toEqual([]);
	});

	test("replaces content that was not rendered by render_blocks", () => {
		const el = attached_span();
		el.innerHTML = "<p>oud</p>";

		render(el, [], ["nieuw"]);

		expect(el.innerHTML).toBe("<p>nieuw</p>\n");
	});
});
