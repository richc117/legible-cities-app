// The tree of elements a panel returns, walked without rendering it (issue
// 407). The unit suite has no DOM: a panel is called as a function inside a
// component that renders nothing, so its hooks run as React runs them, and
// the elements it returns are kept and searched here for a control, whose
// handler a test then calls as a press would. Nothing in the tree is mounted.

/** An element as the tree holds it: its type and its props. */
export interface TreeElement {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

const isElement = (node: unknown): node is TreeElement =>
  node !== null && typeof node === 'object' && 'props' in node

/** Every element in a tree that `found` accepts, depth first. */
export function find(node: unknown, found: (element: TreeElement) => boolean): TreeElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, found))
  if (!isElement(node)) return []
  return [...(found(node) ? [node] : []), ...find(node.props.children, found)]
}

/** The text an element's children carry, as far as plain strings go. */
export function text(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(text).join('')
  return isElement(node) ? text(node.props.children) : ''
}
