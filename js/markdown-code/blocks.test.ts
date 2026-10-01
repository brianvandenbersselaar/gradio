import { describe, expect, test, vi } from "vitest";
import { create_marked } from "./utils";
import { create_block_parser, replace_latex } from "./blocks";

const latex_delimiters = [
	{ left: "$$", right: "$$", display: true },
	{ left: "$", right: "$", display: false }
];

const FIXTURES: Record<string, string> = {
	paragraphs_and_inline:
		"Een **vette** zin met `code` en _nadruk_.\n\nTweede alinea met een [link](https://example.com).\n",
	setext_heading:
		"Intro tekst\n---\n\nDaarna een alinea.\n\nNog een kop\n===\n",
	lists:
		"- een\n- twee\n  - genest\n- drie\n\n1. eerste\n2. tweede\n\n   met losse alinea\n3. derde\n",
	table: "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nTekst na de tabel.\n",
	code_with_blank_line:
		"Voor de code:\n\n```python\nx = 1\n\ny = 2\n```\n\nNa de code.\n",
	reference_links:
		"Zie [de site][asn] en [nog eens][asn].\n\nAndere tekst.\n\n[asn]: https://asn.nl\n",
	latex:
		"Inline $a_1 + b_2$ en display:\n\n$$\n\\sum_{i=1}^n x_i\n$$\n\nEn $c^2$ daarna.\n",
	blockquote_and_hr: "> geciteerd\n> **vet**\n\n---\n\nKlaar.\n",
	html_and_breaks:
		"Regel een\nregel twee<br>\n\n<details><summary>Meer</summary>\n\nverborgen\n\n</details>\n"
};

async function full_render(
	marked: ReturnType<typeof create_marked>,
	text: string
): Promise<string> {
	// The current MarkdownCode pipeline, before sanitizing: protect LaTeX, parse everything, restore.
	const { text: protected_text, restore } = replace_latex(
		text,
		latex_delimiters
	);
	return restore((await marked.parse(protected_text)) as string);
}

describe("create_block_parser", () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		test(`streaming every prefix of "${name}" matches a full render`, async () => {
			const marked = create_marked({
				header_links: false,
				line_breaks: true,
				latex_delimiters
			});
			const parse_blocks = create_block_parser(marked, latex_delimiters);

			for (let end = 1; end <= fixture.length; end++) {
				const prefix = fixture.slice(0, end);
				const blocks = await parse_blocks(prefix);
				expect(
					blocks.map((b) => b.html).join(""),
					`prefix ${JSON.stringify(prefix)}`
				).toBe(await full_render(marked, prefix));
			}
		});
	}

	test("appending text only parses the blocks that changed", async () => {
		const marked = create_marked({
			header_links: false,
			line_breaks: true,
			latex_delimiters
		});
		const parse_blocks = create_block_parser(marked, latex_delimiters);
		const parser = vi.spyOn(marked, "parser");
		const text =
			FIXTURES.paragraphs_and_inline + FIXTURES.lists + FIXTURES.table;

		await parse_blocks(text);
		parser.mockClear();
		await parse_blocks(text + "Nieuwe alinea");

		expect(parser).toHaveBeenCalledTimes(1); // the last paragraph, which the new text joins
		parser.mockClear();
		await parse_blocks(text + "Nieuwe alinea");
		expect(parser).not.toHaveBeenCalled();
	});

	test("forgets blocks that are no longer in the text", async () => {
		const marked = create_marked({
			header_links: false,
			line_breaks: true,
			latex_delimiters
		});
		const parse_blocks = create_block_parser(marked, latex_delimiters);
		const parser = vi.spyOn(marked, "parser");

		await parse_blocks("Eerste versie.\n");
		await parse_blocks("Tweede versie.\n");
		parser.mockClear();
		await parse_blocks("Eerste versie.\n");

		expect(parser).toHaveBeenCalledTimes(1);
	});

	test("heading ids depend only on the text, not on earlier renders", async () => {
		const marked = create_marked({
			header_links: true,
			line_breaks: true,
			latex_delimiters
		});
		const parse_blocks = create_block_parser(marked, latex_delimiters);
		const text = "## Kop\n\nTekst.\n\n## Kop\n\nMeer.\n";

		for (let end = 1; end <= text.length; end++)
			await parse_blocks(text.slice(0, end));
		const streamed = (await parse_blocks(text)).map((b) => b.html).join("");
		const cold = (
			await create_block_parser(
				create_marked({
					header_links: true,
					line_breaks: true,
					latex_delimiters
				}),
				latex_delimiters
			)(text)
		)
			.map((b) => b.html)
			.join("");

		expect(streamed).toBe(cold);
		expect(
			[...streamed.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1])
		).toEqual(["h-kop", "h-kop-1"]);
	});

	test("a duplicate heading earlier in the text renumbers the headings after it", async () => {
		const marked = create_marked({
			header_links: true,
			line_breaks: true,
			latex_delimiters
		});
		const parse_blocks = create_block_parser(marked, latex_delimiters);

		await parse_blocks("Intro.\n\n## Kop\n");
		const html = (await parse_blocks("## Kop\n\nIntro.\n\n## Kop\n"))
			.map((b) => b.html)
			.join("");

		expect([...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1])).toEqual([
			"h-kop",
			"h-kop-1"
		]);
	});
});
