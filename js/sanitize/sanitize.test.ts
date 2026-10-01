import { describe, expect, test, vi } from "vitest";

import { sanitize, sanitize_fragment } from "./browser";

function serialize(fragment: DocumentFragment): string {
	const template = document.createElement("template");
	template.content.append(fragment);
	return template.innerHTML;
}

describe.each([
	["sanitize", sanitize],
	[
		"sanitize_fragment",
		(source: string) => serialize(sanitize_fragment(source))
	]
])("%s", (_, sanitize) => {
	test("opens non-fragment links in a new tab", () => {
		const node = new DOMParser().parseFromString(
			sanitize('<a href="/docs">docs</a>'),
			"text/html"
		);

		const link = node.querySelector("a");
		expect(link?.getAttribute("href")).toBe("/docs");
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
	});

	test("keeps hash-only links in the same page", () => {
		const node = new DOMParser().parseFromString(
			sanitize('<a href="#section">section</a>'),
			"text/html"
		);

		const link = node.querySelector("a");
		expect(link?.getAttribute("href")).toBe("#section");
		expect(link?.getAttribute("target")).toBeNull();
		expect(link?.getAttribute("rel")).toBeNull();
	});

	test("removes style elements and their content", () => {
		const result = sanitize(
			"<p>hello</p><style>body { background: red; }</style>"
		);

		expect(result).toBe("<p>hello</p>");
	});

	test("removes style elements inside svg", () => {
		const result = sanitize(
			"<svg><style>body { background: red; }</style><circle r='1'></circle></svg>"
		);

		expect(result).not.toContain("<style>");
		expect(result).toContain("<circle");
	});

	test("removes link elements", () => {
		const result = sanitize(
			'<p>hello</p><link rel="stylesheet" href="https://example.com/style.css">'
		);

		expect(result).toBe("<p>hello</p>");
	});

	test("keeps style attributes", () => {
		const node = new DOMParser().parseFromString(
			sanitize('<p style="color: red;">hello</p>'),
			"text/html"
		);

		const p = node.querySelector("p");
		expect(p?.getAttribute("style")).toBe("color: red;");
		expect(p?.textContent).toBe("hello");
	});

	test("does not create node iterators on the main document", () => {
		// A node iterator created on the main document keeps its root alive,
		// leaking the parsed document on every call (#13884).
		const spy = vi.spyOn(document, "createNodeIterator");
		try {
			expect(sanitize("<p><b>bold</b> text</p>")).toBe(
				"<p><b>bold</b> text</p>"
			);
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
});

describe("sanitize_fragment", () => {
	test("parses once, without a throwaway document", () => {
		const spy = vi.spyOn(DOMParser.prototype, "parseFromString");
		try {
			const fragment = sanitize_fragment("<p><b>bold</b> text</p>");
			expect(fragment).toBeInstanceOf(DocumentFragment);
			expect(serialize(fragment)).toBe("<p><b>bold</b> text</p>");
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});

	test("does not create node iterators on any document", () => {
		// Template content lives in a document that lasts as long as the page; an iterator
		// created there would keep every sanitized fragment alive (#13884).
		const spy = vi.spyOn(Document.prototype, "createNodeIterator");
		try {
			sanitize_fragment("<div><p><b>bold</b> <a href='/x'>link</a></p></div>");
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});

	test.each([
		'<math><mtext><table><mglyph><style><img src=x onerror="alert(1)">',
		'<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
		'<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
		'<form><math><mtext></form><form><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">'
	])("leaves no event handlers once inserted: %s", (payload) => {
		const inserted = document.createElement("div");
		inserted.append(sanitize_fragment(payload));
		const reparsed = document.createElement("div");
		reparsed.innerHTML = sanitize(payload);

		for (const container of [inserted, reparsed]) {
			const handlers = [...container.querySelectorAll("*")].flatMap((el) =>
				[...el.attributes]
					.filter((a) => a.name.startsWith("on"))
					.map((a) => a.name)
			);
			expect(handlers).toEqual([]);
		}
	});
});
