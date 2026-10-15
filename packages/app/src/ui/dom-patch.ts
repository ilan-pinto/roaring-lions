// A small positional DOM patch: make an element's children match an HTML
// string while keeping every node whose place in the tree has not changed.
//
// Why it exists: the HUD's single-unit card is re-rendered four times a second
// and used to be rebuilt wholesale through `innerHTML`, so a node the keyboard
// player had focused (the "On loan" stamp, the PINNED flag) was a NEW node on
// every rebuild -- focus dropped, and a screen reader may re-announce it. A
// patch keeps the node, so there is no focus change to announce at all.
//
// Positional, no keys: child N of the target is compared with child N of the
// new markup. Same node type and same tag -> the node is kept and patched;
// otherwise that one node is replaced. An inserted or removed child therefore
// shifts everything after it, and those nodes are replaced too -- the right
// trade for markup whose shape is stable and whose values change.

/** Attributes the PATCH NEVER REMOVES, because something other than the
 *  markup owns them. `aria-describedby` is set on the focused/hovered node by
 *  the tooltip machinery (`tooltip.ts`) while its tip is open; the new html
 *  does not carry it, and stripping it would silently close the tip's
 *  association with the node it describes. If the html itself ever names one,
 *  it is written like any other attribute. Add to this list, never special-case
 *  a caller. */
const BROWSER_OWNED_ATTRIBUTES: ReadonlySet<string> = new Set(['aria-describedby']);

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  const x = a as Element;
  const y = b as Element;
  return x.localName === y.localName && x.namespaceURI === y.namespaceURI;
}

function patchAttributes(target: Element, source: Element): boolean {
  let wrote = false;
  for (const attr of Array.from(source.attributes)) {
    if (target.getAttribute(attr.name) === attr.value) continue;
    if (attr.namespaceURI !== null) target.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    else target.setAttribute(attr.name, attr.value);
    wrote = true;
  }
  for (const attr of Array.from(target.attributes)) {
    if (source.hasAttribute(attr.name) || BROWSER_OWNED_ATTRIBUTES.has(attr.name)) continue;
    target.removeAttribute(attr.name);
    wrote = true;
  }
  return wrote;
}

function patchNodes(target: Node, source: Node): boolean {
  let wrote = false;
  const incoming = Array.from(source.childNodes);
  incoming.forEach((next, i) => {
    const current = target.childNodes[i];
    if (!current) {
      target.appendChild(document.importNode(next, true));
      wrote = true;
    } else if (!sameKind(current, next)) {
      target.replaceChild(document.importNode(next, true), current);
      wrote = true;
    } else if (next.nodeType === Node.ELEMENT_NODE) {
      if (patchAttributes(current as Element, next as Element)) wrote = true;
      if (patchNodes(current, next)) wrote = true;
    } else if (current.nodeValue !== next.nodeValue) {
      current.nodeValue = next.nodeValue;
      wrote = true;
    }
  });
  while (target.childNodes.length > incoming.length) {
    target.removeChild(target.childNodes[incoming.length]);
    wrote = true;
  }
  return wrote;
}

/** Make `target`'s children match `html`, reusing every existing node whose position, node type
 *  and tag match: attributes are set/removed to match, text nodes get new `data` only when it
 *  differs, and children are patched recursively. A node that differs in type or tag is replaced
 *  (and everything after an inserted/removed child is replaced too: positional, no keys). Never
 *  touches `target` itself. Returns true if anything was written.
 *
 *  `html` is parsed in an inert `<template>`: no script runs and no image loads
 *  until a node is actually inserted. `aria-describedby` is never removed (see
 *  `BROWSER_OWNED_ATTRIBUTES`). */
export function patchChildren(target: Element, html: string): boolean {
  const template = document.createElement('template');
  template.innerHTML = html;
  return patchNodes(target, template.content);
}
