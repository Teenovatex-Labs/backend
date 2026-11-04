import { XMLParser } from 'fast-xml-parser';

// Badge artwork may be SVG, which can carry scripts. Instead of trying to strip the dangerous parts out of
// what was uploaded, the file is parsed and a NEW document is built from an allow-list of drawing elements
// and attributes. Anything not on the list is simply never copied across.

export const SVG_MAX_BYTES = 200 * 1024;

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'text', 'tspan',
]);
const TEXT_ELEMENTS = new Set(['title', 'desc', 'text', 'tspan']);

const ATTRIBUTES = new Set([
  'id', 'class', 'xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'version',
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'fx', 'fy', 'points', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'clip-path', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'clipPathUnits', 'spreadMethod',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'letter-spacing',
]);

export class SvgRejected extends Error {}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A value may reference something inside the file (`url(#a)`), and nothing else. */
const safeValue = (v: string): boolean => {
  const l = v.toLowerCase();
  if (/javascript:|data:|vbscript:|@import|expression\s*\(|&#|\\|<|>/.test(l)) return false;
  const urls = l.match(/url\s*\(([^)]*)\)/g) ?? [];
  return urls.every((u) => /^url\(\s*['"]?#[\w-]+['"]?\s*\)$/.test(u));
};

type Node = Record<string, unknown>;

const build = (nodes: Node[], parentTag: string | null): string => {
  let out = '';
  for (const node of nodes) {
    if ('#text' in node) {
      if (parentTag && TEXT_ELEMENTS.has(parentTag)) out += escape(String(node['#text']));
      continue;
    }
    const tag = Object.keys(node).find((k) => k !== ':@');
    // A link wrapper is harmless once its link is gone, so its drawing is kept. Any other unknown element is
    // dropped with everything inside it.
    if (tag === 'a') { out += build(node[tag] as Node[], parentTag); continue; }
    if (!tag || !ELEMENTS.has(tag)) continue;
    const rawAttrs = (node[':@'] ?? {}) as Record<string, string>;
    const attrs = Object.entries(rawAttrs)
      .map(([k, v]) => [k.replace(/^@_/, ''), String(v)] as const)
      .filter(([k, v]) => ATTRIBUTES.has(k) && !k.toLowerCase().startsWith('on') && safeValue(v))
      .map(([k, v]) => ` ${k}="${escape(v)}"`)
      .join('');
    const inner = build(node[tag] as Node[], tag);
    out += `<${tag}${attrs}>${inner}</${tag}>`;
  }
  return out;
};

/** Returns a clean SVG string, or throws SvgRejected when the file is not usable artwork. */
export const sanitizeSvg = (input: string): string => {
  if (Buffer.byteLength(input) > SVG_MAX_BYTES) throw new SvgRejected('SVG files must be under 200 KB.');
  // Entities and CDATA are how XML tricks (expansion bombs, hidden payloads) are smuggled in.
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\?xml-stylesheet/i.test(input)) throw new SvgRejected('This SVG uses features that are not allowed.');
  let tree: Node[];
  try {
    tree = new XMLParser({ ignoreAttributes: false, preserveOrder: true, processEntities: false, trimValues: false, allowBooleanAttributes: false }).parse(input) as Node[];
  } catch {
    throw new SvgRejected('This file is not a valid SVG.');
  }
  const root = tree.find((n) => Object.keys(n).includes('svg'));
  if (!root) throw new SvgRejected('This file is not a valid SVG.');
  const clean = build([root], null);
  if (!/<(path|circle|ellipse|rect|line|polyline|polygon|text)\b/.test(clean)) throw new SvgRejected('This SVG has nothing to draw.');
  // The namespace is required for the file to render as an image.
  return clean.includes('xmlns=') ? clean : clean.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
};
