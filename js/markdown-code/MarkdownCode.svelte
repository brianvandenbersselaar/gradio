<script lang="ts">
	import { tick } from "svelte";
	import { create_marked } from "./utils";
	import { create_block_parser, type Block } from "./blocks";
	import { render_blocks, type RenderedBlock } from "./render";
	import { sanitize_fragment } from "@gradio/sanitize";
	import "./prism.css";
	import { standardHtmlAndSvgTags } from "./html-tags";
	import type { ThemeMode } from "@gradio/core";

	let {
		chatbot = true,
		message,
		sanitize_html = true,
		latex_delimiters = [],
		render_markdown = true,
		line_breaks = true,
		header_links = false,
		allow_tags = false,
		theme_mode = "system",
		onload
	}: {
		chatbot?: boolean;
		message: string;
		sanitize_html?: boolean;
		latex_delimiters?: {
			left: string;
			right: string;
			display: boolean;
		}[];
		render_markdown?: boolean | undefined;
		line_breaks?: boolean;
		header_links?: boolean;
		allow_tags?: string[] | boolean | undefined;
		theme_mode?: ThemeMode;
		onload?: () => void;
	} = $props();

	let el: HTMLSpanElement;

	const marked = create_marked({
		header_links,
		line_breaks,
		latex_delimiters: latex_delimiters || []
	});
	const parse_blocks = create_block_parser(
		marked,
		latex_delimiters || [],
		(html) => (allow_tags ? escapeTags(html, allow_tags) : html)
	);

	let rendered: RenderedBlock[] = [];
	let rendering = false;
	let pending: string | null = null;

	// One render at a time; updates that arrive meanwhile collapse into the latest text, so a slow
	// render never falls behind a fast stream.
	$effect(() => {
		pending = message ?? "";
		if (!rendering) void render_pending();
	});

	async function render_pending(): Promise<void> {
		rendering = true;
		try {
			while (pending !== null && el) {
				const text = pending;
				pending = null;
				await render(text);
			}
		} finally {
			rendering = false;
		}
	}

	async function render(text: string): Promise<void> {
		let blocks: Block[] = [];
		if (text.trim()) {
			blocks = render_markdown
				? await parse_blocks(text)
				: [
						{
							key: text,
							html: allow_tags ? escapeTags(text, allow_tags) : text
						}
					];
		}
		const result = render_blocks(el, rendered, blocks, to_fragment);
		rendered = result.rendered;
		await post_process(result.inserted, text);
		onload?.();
	}

	function to_fragment(html: string): DocumentFragment {
		if (sanitize_html) return sanitize_fragment(html);
		const template = document.createElement("template");
		template.innerHTML = html;
		return template.content;
	}

	let katex_loaded = false;

	function has_math_syntax(text: string): boolean {
		if (!latex_delimiters || latex_delimiters.length === 0) {
			return false;
		}

		return latex_delimiters.some(
			(delimiter) =>
				text.includes(delimiter.left) && text.includes(delimiter.right)
		);
	}

	function escapeTags(
		content: string,
		tagsToEscape: string[] | boolean
	): string {
		if (tagsToEscape === true) {
			// https://www.w3schools.com/tags/
			const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([\s>])/g;
			return content.replace(tagRegex, (match, tagName, endChar) => {
				if (!standardHtmlAndSvgTags.includes(tagName.toLowerCase())) {
					return match.replace(/</g, "&lt;").replace(/>/g, "&gt;");
				}
				return match;
			});
		}

		if (Array.isArray(tagsToEscape)) {
			const tagPattern = tagsToEscape.map((tag) => ({
				open: new RegExp(`<(${tag})(\\s+[^>]*)?>`, "gi"),
				close: new RegExp(`</(${tag})>`, "gi")
			}));

			let result = content;

			tagPattern.forEach((pattern) => {
				result = result.replace(pattern.open, (match) =>
					match.replace(/</g, "&lt;").replace(/>/g, "&gt;")
				);
				result = result.replace(pattern.close, (match) =>
					match.replace(/</g, "&lt;").replace(/>/g, "&gt;")
				);
			});
			return result;
		}
		return content;
	}

	// KaTeX and mermaid only see the nodes this render inserted; earlier blocks were processed when
	// they were inserted and are left untouched.
	async function post_process(inserted: Node[], text: string): Promise<void> {
		const elements = inserted.filter(
			(node): node is HTMLElement => node instanceof HTMLElement
		);
		if (elements.length === 0) return;

		if (has_math_syntax(text)) {
			if (!katex_loaded) {
				await import("katex/dist/katex.min.css");
				katex_loaded = true;
			}
			const { default: render_math_in_element } =
				await import("katex/contrib/auto-render");
			for (const element of elements) {
				render_math_in_element(element, {
					delimiters: latex_delimiters,
					throwOnError: false
				});
			}
		}

		const mermaid_nodes = elements.flatMap((element) => [
			...(element.matches(".mermaid") ? [element] : []),
			...element.querySelectorAll<HTMLElement>(".mermaid")
		]);
		if (mermaid_nodes.length > 0) {
			await tick();
			const { default: mermaid } = await import("mermaid");

			mermaid.initialize({
				startOnLoad: false,
				theme: theme_mode === "dark" ? "dark" : "default",
				securityLevel: "antiscript"
			});
			await mermaid.run({ nodes: mermaid_nodes });
		}
	}
</script>

<span class:chatbot bind:this={el} class="md" class:prose={render_markdown}
></span>

<style>
	span {
		/* `anywhere`, not `break-word`: it also lowers min-content width, so
		   markdown in a table/flex container shrinks to fit instead of forcing
		   the container to overflow. */
		overflow-wrap: anywhere;
	}

	span :global(div[class*="code_wrap"]) {
		position: relative;
	}

	/* KaTeX */
	span :global(span.katex) {
		font-size: var(--text-lg);
		direction: ltr;
	}

	span :global(div[class*="code_wrap"] > button) {
		z-index: 1;
		cursor: pointer;
		border-bottom-left-radius: var(--radius-sm);
		padding: var(--spacing-md);
		width: 25px;
		height: 25px;
		position: absolute;
		right: 0;
	}

	span :global(.check) {
		opacity: 0;
		z-index: var(--layer-top);
		transition: opacity 0.2s;
		background: var(--code-background-fill);
		color: var(--body-text-color);
		position: absolute;
		top: var(--size-1-5);
		left: var(--size-1-5);
	}

	span :global(p:not(:first-child)) {
		margin-top: var(--spacing-xxl);
	}

	span :global(.md-header-anchor) {
		/* position: absolute; */
		margin-left: -25px;
		padding-right: 8px;
		line-height: 1;
		color: var(--body-text-color-subdued);
		opacity: 0;
	}

	span :global(h1:hover .md-header-anchor),
	span :global(h2:hover .md-header-anchor),
	span :global(h3:hover .md-header-anchor),
	span :global(h4:hover .md-header-anchor),
	span :global(h5:hover .md-header-anchor),
	span :global(h6:hover .md-header-anchor) {
		opacity: 1;
	}

	span.md :global(.md-header-anchor > svg) {
		color: var(--body-text-color-subdued);
	}

	span :global(table) {
		word-break: break-word;
	}
</style>
