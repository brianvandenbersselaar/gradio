import GithubSlugger from "github-slugger";
import type { Marked, Token, Tokens, TokensList } from "marked";
import { heading_slug_source } from "./utils";

type LatexDelimiter = { left: string; right: string; display: boolean };

export interface Block {
	key: string;
	html: string;
}

function escape_regexp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Swap LaTeX for placeholders so marked leaves it alone; `restore` puts it back.
 */
export function replace_latex(
	text: string,
	delimiters: LatexDelimiter[]
): { text: string; restore: (value: string) => string } {
	const latex_blocks: string[] = [];
	let replaced = text;
	for (const delimiter of delimiters) {
		const regex = new RegExp(
			`${escape_regexp(delimiter.left)}([\\s\\S]+?)${escape_regexp(delimiter.right)}`,
			"g"
		);
		replaced = replaced.replace(regex, (match) => {
			latex_blocks.push(match);
			return `%%%LATEX_BLOCK_${latex_blocks.length - 1}%%%`;
		});
	}
	return {
		text: replaced,
		restore: (value) =>
			value.replace(
				/%%%LATEX_BLOCK_(\d+)%%%/g,
				(_, index) => latex_blocks[parseInt(index, 10)]
			)
	};
}

/**
 * Render markdown as a list of top-level blocks, reusing the HTML of blocks that did not change.
 *
 * While a message streams in, only its last block or two change between updates, so re-rendering
 * just those keeps the work per update proportional to the changed block instead of the whole
 * message. The output is identical to a full `marked.parse`: every top-level token runs through the
 * same hooks, `walkTokens` (async highlighting) and parser.
 *
 * Known limit: the unit of reuse is a top-level token, so one large token that keeps growing is
 * still rebuilt as a whole on every update. The common case is a long list whose items are
 * separated by blank lines (a "loose" list), which marked lexes as a single token, and long tables.
 * In a streamed answer that is mostly one such list, the cost per update grows with the list
 * instead of the message. Reusing list items and table rows inside their container element would
 * remove that, at the cost of re-implementing marked's list and table rendering per item.
 *
 * `transform` post-processes the HTML of each changed block before it is cached.
 *
 * Calls must not overlap: the cache is replaced at the end of each call.
 */
export function create_block_parser(
	marked: Marked,
	latex_delimiters: LatexDelimiter[],
	transform: (html: string) => string = (html) => html
): (text: string) => Promise<Block[]> {
	let cache = new Map<string, string>();
	let links = "";

	return async function parse_blocks(text: string): Promise<Block[]> {
		const { text: source, restore } = replace_latex(text, latex_delimiters);
		const options = { ...marked.defaults };
		const hooks = options.hooks;
		if (hooks) hooks.options = options;
		// With `async: true` marked wraps every hook to return a promise, so each one is awaited.
		const lexed = marked.lexer(
			hooks ? await hooks.preprocess(source) : source,
			options
		);
		const tokens = (
			hooks ? await hooks.processAllTokens(lexed) : lexed
		) as TokensList;

		// A reference definition (`[x]: url`) changes how earlier, unchanged blocks render.
		const next_links = JSON.stringify(tokens.links ?? {});
		if (next_links !== links) {
			cache = new Map();
			links = next_links;
		}

		// Heading ids depend on the headings before them, so they are part of the cache key.
		const slugger = new GithubSlugger();
		const keys = tokens.map((token) => {
			const ids: string[] = [];
			marked.walkTokens([token], (child) => {
				if (child.type === "heading") {
					const heading = child as Tokens.Heading & { id?: string };
					heading.id = "h" + slugger.slug(heading_slug_source(heading.raw));
					ids.push(heading.id);
				}
			});
			const key = restore(token.raw);
			return ids.length ? `${key}\u0000${ids.join(" ")}` : key;
		});

		const misses = tokens.filter((_, i) => !cache.has(keys[i]));
		if (options.walkTokens) {
			await Promise.all(marked.walkTokens(misses, options.walkTokens));
		}

		const next_cache = new Map<string, string>();
		const blocks: Block[] = [];
		for (const [i, token] of (tokens as Token[]).entries()) {
			let html = cache.get(keys[i]) ?? next_cache.get(keys[i]);
			if (html === undefined) {
				html = marked.parser([token], options);
				if (hooks) html = await hooks.postprocess(html);
				html = transform(restore(html));
			}
			next_cache.set(keys[i], html);
			blocks.push({ key: keys[i], html });
		}
		// Only the current blocks stay cached, so the intermediate versions of a block that is
		// still streaming in are dropped right away.
		cache = next_cache;
		return blocks;
	};
}
