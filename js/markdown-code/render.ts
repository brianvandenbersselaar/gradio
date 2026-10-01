import type { Block } from "./blocks";

export interface RenderedBlock {
	key: string;
	nodes: Node[];
}

/**
 * Update `el` from `previous` to `blocks`, touching only the blocks that changed.
 *
 * The common prefix and suffix of both lists keep their DOM nodes; the blocks in between are
 * replaced. While a message streams in, that middle is the last block or two. Block nodes are
 * direct children of `el`, without wrappers, so sibling selectors such as `.prose > *:first-child`
 * keep working.
 */
export function render_blocks(
	el: HTMLElement,
	previous: RenderedBlock[],
	blocks: Block[],
	to_fragment: (html: string) => DocumentFragment
): { rendered: RenderedBlock[]; inserted: Node[] } {
	if (previous.length === 0) el.replaceChildren();

	let start = 0;
	while (
		start < previous.length &&
		start < blocks.length &&
		previous[start].key === blocks[start].key
	) {
		start++;
	}
	let end = 0;
	while (
		end < previous.length - start &&
		end < blocks.length - start &&
		previous[previous.length - 1 - end].key ===
			blocks[blocks.length - 1 - end].key
	) {
		end++;
	}

	const kept_after = previous.slice(previous.length - end);
	for (const old of previous.slice(start, previous.length - end)) {
		for (const node of old.nodes) node.parentNode?.removeChild(node);
	}

	const anchor = kept_after.find((b) => b.nodes.length)?.nodes[0] ?? null;
	const inserted: Node[] = [];
	const middle = blocks.slice(start, blocks.length - end).map((b) => {
		const fragment = to_fragment(b.html);
		const nodes = [...fragment.childNodes];
		el.insertBefore(fragment, anchor);
		inserted.push(...nodes);
		return { key: b.key, nodes };
	});

	return {
		rendered: [...previous.slice(0, start), ...middle, ...kept_after],
		inserted
	};
}
