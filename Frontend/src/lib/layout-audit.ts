/**
 * Dev-time layout audit.
 *
 * The header once let a long "What's on" label paint over its neighbours, because a flex child
 * kept its intrinsic width while its box was clamped. This module finds that class of bug
 * (and its friends) without a screenshot test:
 *
 *  - overlap : two siblings in normal flow paint on top of each other
 *  - escape  : an element's content is wider/taller than its own box (overflow is visible)
 *  - clipped : content is cut off with no ellipsis, so the user silently loses text
 *
 * Overlays (dialogs, popovers, menus, tooltips, toasts) are intentionally stacked, so they are
 * skipped entirely. Anything marked `data-layout-ignore` is skipped too.
 */

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type LayoutIssueKind = "overlap" | "escape" | "clipped";

export interface LayoutIssue {
  kind: LayoutIssueKind;
  element: HTMLElement;
  other?: HTMLElement;
  detail: string;
}

/** True when two boxes share more than `tolerance` px on both axes. */
export function rectsOverlap(a: RectLike, b: RectLike, tolerance = 1): boolean {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlapX > tolerance && overlapY > tolerance;
}

/** "horizontal" | "vertical" | null — which axis (if any) has content bigger than the box. */
export function overflowAxis(
  scrollWidth: number,
  clientWidth: number,
  scrollHeight: number,
  clientHeight: number,
  tolerance = 2,
): "horizontal" | "vertical" | null {
  if (scrollWidth - clientWidth > tolerance) return "horizontal";
  if (scrollHeight - clientHeight > tolerance) return "vertical";
  return null;
}

const SKIP_SELECTOR = [
  "[data-layout-ignore]",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='menu']",
  "[role='listbox']",
  "[role='tooltip']",
  "[data-radix-popper-content-wrapper]",
  "[data-sonner-toaster]",
  "[aria-hidden='true']",
  "script",
  "style",
  "head",
].join(",");

const FLOW_POSITIONS = new Set(["static", "relative"]);
const CONTENT_CHECK_SKIP = /^(INPUT|TEXTAREA|SELECT|IMG|VIDEO|CANVAS|SVG|IFRAME|BR|HR)$/;

function styleOf(el: Element): CSSStyleDeclaration {
  return getComputedStyle(el);
}

/** Absolutely positioned children (badges, decorations) live outside the parent's box on purpose. */
function hasOutOfFlowChild(el: HTMLElement): boolean {
  for (const child of Array.from(el.children)) {
    const position = getComputedStyle(child).position;
    if (position === "absolute" || position === "fixed") return true;
  }
  return false;
}

/**
 * Inline (non-replaced) boxes report clientWidth 0, so overflow math is meaningless for them.
 * Form controls scroll their own text internally, and replaced elements are sized by CSS.
 */
function canMeasureContent(el: HTMLElement, style: CSSStyleDeclaration): boolean {
  if (CONTENT_CHECK_SKIP.test(el.tagName)) return false;
  if (style.display === "inline" || style.display === "contents") return false;
  return !hasOutOfFlowChild(el);
}

function isVisible(el: HTMLElement, style: CSSStyleDeclaration, rect: DOMRect): boolean {
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (Number(style.opacity) === 0) return false;
  if (rect.width < 2 || rect.height < 2) return false;
  if (el.closest(SKIP_SELECTOR)) return false;
  return true;
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className.trim()
    ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
    : "";
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return `<${tag}${id}${cls}>${text ? ` "${text}"` : ""}`;
}

interface Candidate {
  el: HTMLElement;
  rect: RectLike;
  style: CSSStyleDeclaration;
}

/**
 * Walks the rendered tree under `root` and returns layout problems.
 * Safe to call on the server: it does nothing when there is no document.
 */
export function auditLayout(root: HTMLElement | null = typeof document === "undefined" ? null : document.body): LayoutIssue[] {
  if (!root || typeof window === "undefined") return [];

  const issues: LayoutIssue[] = [];
  const candidates: Candidate[] = [];
  const byParent = new Map<Element | null, Candidate[]>();

  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    // Text-less wrappers and SVG internals cannot overlap visually in a useful way.
    if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    const style = styleOf(el);
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, style, rect)) continue;

    // 1. Content wider than its own box: it paints over the neighbour.
    if (canMeasureContent(el, style)) {
      const overX = el.scrollWidth - el.clientWidth > 2;
      const overY = el.scrollHeight - el.clientHeight > 2;
      const { overflowX, overflowY } = style;
      const ellipsis = style.textOverflow === "ellipsis";

      // Visible overflow spills across the next element — always a bug.
      if (overX && overflowX === "visible") {
        issues.push({ kind: "escape", element: el, detail: `content overflows its horizontal box (${describe(el)})` });
      }
      if (overY && overflowY === "visible") {
        issues.push({ kind: "escape", element: el, detail: `content overflows its vertical box (${describe(el)})` });
      }

      // `auto` / `scroll` means the user can reach the content, so nothing is lost or overlapped.
      const clipX = overflowX === "hidden" || overflowX === "clip";
      const clipY = overflowY === "hidden" || overflowY === "clip";
      if (overX && clipX && !ellipsis) {
        issues.push({ kind: "clipped", element: el, detail: `content clipped on the horizontal axis (${describe(el)})` });
      }
      if (overY && clipY && !ellipsis) {
        issues.push({ kind: "clipped", element: el, detail: `content clipped on the vertical axis (${describe(el)})` });
      }
    }

    // Only normal-flow boxes are compared for overlap; overlays may stack on purpose.
    if (!FLOW_POSITIONS.has(style.position)) continue;
    const candidate: Candidate = { el, rect, style };
    candidates.push(candidate);
    const parent = el.parentElement;
    const bucket = byParent.get(parent);
    if (bucket) bucket.push(candidate);
    else byParent.set(parent, [candidate]);
  }

  // 3. Siblings in normal flow must never share pixels.
  for (const siblings of byParent.values()) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i]!;
        const b = siblings[j]!;
        if (!rectsOverlap(a.rect, b.rect, 2)) continue;
        issues.push({
          kind: "overlap",
          element: a.el,
          other: b.el,
          detail: `${describe(a.el)} overlaps ${describe(b.el)}`,
        });
      }
    }
  }

  return issues;
}

/** Short signature so the dev overlay can warn once per distinct problem. */
export function issueSignature(issue: LayoutIssue): string {
  return `${issue.kind}|${describe(issue.element)}|${issue.other ? describe(issue.other) : ""}`;
}