export type RectPx = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type RegionPct = { x: number; y: number; width: number; height: number };

/** Normalize a pixel rect to percentages of the container, clamped to 0–100. */
export function normalizeRect(rect: RectPx, size: Size): RegionPct {
  const width = size.width <= 0 ? 0 : (rect.width / size.width) * 100;
  const height = size.height <= 0 ? 0 : (rect.height / size.height) * 100;
  return {
    x: clampPct((rect.x / (size.width || 1)) * 100),
    y: clampPct((rect.y / (size.height || 1)) * 100),
    width: clampPct(width),
    height: clampPct(height),
  };
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
}

export type AnnotationTarget =
  | { kind: "html"; filePath: string; selector: string; label: string }
  | { kind: "url"; url: string; region: RegionPct };

export function buildPrompt(
  target: AnnotationTarget,
  instruction: string,
): string {
  const heading =
    target.kind === "html"
      ? `@${target.filePath}\n\nRegion ${target.selector}`
      : `Page at ${target.url}\n\nRegion ${formatRegion(target.region)}`;
  const body = instruction.trim();
  return body ? `${heading}\n\n${body}` : heading;
}

function formatRegion(region: RegionPct): string {
  const { x, y, width, height } = region;
  return `${x}%–${round(x + width)}%, ${y}%–${round(y + height)}% of the viewport`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Minimal element-like shape so selector building is unit-testable without a DOM. */
export type SelectorElement = {
  id?: string;
  tagName: string;
  className?: string;
  getAttribute: (name: string) => string | null;
  /** Same-shaped siblings; used to compute nth-of-type disambiguation. */
  children?: SelectorElement[];
};

/**
 * Build a compact, deterministic CSS selector for an element, preferring
 * id > classes > tag:nth-of-type. Returns an empty string for html/body.
 */
export function buildSelector(el: SelectorElement): string {
  if (!el || typeof el.tagName !== "string") return "";
  const tag = el.tagName.toLowerCase();
  if (tag === "html" || tag === "body") return "";

  const id = el.getAttribute?.("id");
  if (id) return `#${escapeId(id)}`;

  const classList = (el.className ?? "")
    .toString()
    .split(/\s+/)
    .filter(Boolean);
  const classes = classList.slice(0, 2).map(escapeClass);
  if (classes.length) return `${tag}${classes.map((c) => `.${c}`).join("")}`;

  const siblings = el.children ?? [];
  const sameTag = siblings.filter(
    (sibling) => sibling && sibling.tagName === el.tagName,
  );
  if (sameTag.length > 1) {
    const index = sameTag.indexOf(el);
    if (index >= 0) return `${tag}:nth-of-type(${index + 1})`;
  }

  return tag;
}

function escapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function escapeClass(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
