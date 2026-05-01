import { CoreComponent, defineCoreElement } from "./components.ts";

export const CORE_LAYOUT_TAG_NAME = "core-layout";
export const DEFAULT_CORE_LAYOUT_VARIANT = "HCF";

export type CoreLayoutSlot = "H" | "L" | "C" | "R" | "F";

export interface CoreLayoutRegion {
  readonly slot: CoreLayoutSlot;
  readonly path: string;
  readonly regions: readonly CoreLayoutRegion[];
}

export interface CoreLayoutTree {
  readonly variant: string;
  readonly regions: readonly CoreLayoutRegion[];
}

const CORE_LAYOUT_SLOTS = new Set<string>(["H", "L", "C", "R", "F"]);
const CORE_LAYOUT_BODY_SLOTS: readonly CoreLayoutSlot[] = ["L", "C", "R"];

const CORE_LAYOUT_REGION_META: Record<
  CoreLayoutSlot,
  {
    readonly tagName: string;
    readonly role: string;
    readonly className: string;
    readonly part: string;
  }
> = {
  H: {
    tagName: "header",
    role: "banner",
    className: "hlcrf-header",
    part: "header",
  },
  L: {
    tagName: "nav",
    role: "navigation",
    className: "hlcrf-left",
    part: "left",
  },
  C: {
    tagName: "main",
    role: "main",
    className: "hlcrf-content",
    part: "content",
  },
  R: {
    tagName: "aside",
    role: "complementary",
    className: "hlcrf-right",
    part: "right",
  },
  F: {
    tagName: "footer",
    role: "contentinfo",
    className: "hlcrf-footer",
    part: "footer",
  },
};

const CORE_LAYOUT_STYLE = `<style>
:host {
  box-sizing: border-box;
  display: block;
}

*, *::before, *::after {
  box-sizing: inherit;
}

.hlcrf-layout {
  display: flex;
  flex-direction: column;
  gap: var(--core-layout-gap, 0);
  min-width: 0;
}

.hlcrf-body {
  align-items: stretch;
  display: flex;
  flex: 1 1 auto;
  gap: var(--core-layout-body-gap, var(--core-layout-gap, 0));
  min-width: 0;
}

.hlcrf-region {
  min-width: 0;
}

.hlcrf-header,
.hlcrf-footer {
  flex: 0 0 auto;
}

.hlcrf-left {
  flex: 0 0 var(--core-layout-left-width, 16rem);
}

.hlcrf-content {
  flex: 1 1 auto;
}

.hlcrf-right {
  flex: 0 0 var(--core-layout-right-width, 16rem);
}

@media (max-width: 767px) {
  .hlcrf-body {
    flex-direction: column;
  }

  .hlcrf-left,
  .hlcrf-right {
    flex-basis: auto;
  }
}
</style>`;

export class CoreLayout extends CoreComponent {
  static get observedAttributes(): string[] {
    return ["variant"];
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  protected template(): string {
    return renderCoreLayoutTemplate(
      this.getAttribute("variant") ?? DEFAULT_CORE_LAYOUT_VARIANT,
    );
  }
}

// Parse an RFC-001 variant such as H[LC]CF into deterministic slot paths.
export function parseCoreLayoutVariant(
  variant = DEFAULT_CORE_LAYOUT_VARIANT,
): CoreLayoutTree {
  const normalisedVariant = variant.toUpperCase();
  const parsed = parseCoreLayoutRegions(normalisedVariant, 0, "");

  return {
    variant: normalisedVariant,
    regions: parsed.regions,
  };
}

// Render the Shadow DOM template used by <core-layout variant="H[LC]CF">.
export function renderCoreLayoutTemplate(
  variant = DEFAULT_CORE_LAYOUT_VARIANT,
): string {
  const tree = parseCoreLayoutVariant(variant);

  return (
    CORE_LAYOUT_STYLE +
    renderCoreLayoutRegionGroup(tree.regions, "root", tree.variant)
  );
}

export function defineCoreLayoutElement(tagName = CORE_LAYOUT_TAG_NAME): void {
  defineCoreElement(tagName, CoreLayout);
}

defineCoreLayoutElement();

function parseCoreLayoutRegions(
  variant: string,
  startIndex: number,
  parentPath: string,
): { readonly regions: CoreLayoutRegion[]; readonly index: number } {
  const regions: CoreLayoutRegion[] = [];
  let index = startIndex;

  while (index < variant.length) {
    const character = variant[index];
    if (character === "]") {
      return { regions, index: index + 1 };
    }

    if (!isCoreLayoutSlot(character)) {
      index++;
      continue;
    }

    const slot = character;
    const path = parentPath ? `${parentPath}-${slot}` : slot;
    index++;

    let childRegions: readonly CoreLayoutRegion[] = [];
    if (variant[index] === "[") {
      const parsedChildren = parseCoreLayoutRegions(variant, index + 1, path);
      childRegions = parsedChildren.regions;
      index = parsedChildren.index;
    }

    regions.push({
      slot,
      path,
      regions: childRegions,
    });
  }

  return { regions, index };
}

function renderCoreLayoutRegionGroup(
  regions: readonly CoreLayoutRegion[],
  layoutPath: string,
  variant: string,
): string {
  const header = renderCoreLayoutRegionsForSlot(regions, "H");
  const body = renderCoreLayoutBody(regions);
  const footer = renderCoreLayoutRegionsForSlot(regions, "F");

  return `<div class="hlcrf-layout" data-layout="${
    escapeCoreLayoutAttribute(layoutPath)
  }" data-variant="${
    escapeCoreLayoutAttribute(
      variant,
    )
  }">${header}${body}${footer}</div>`;
}

function renderCoreLayoutBody(regions: readonly CoreLayoutRegion[]): string {
  const body = CORE_LAYOUT_BODY_SLOTS.map((slot) =>
    renderCoreLayoutRegionsForSlot(regions, slot)
  ).join("");

  if (!body) {
    return "";
  }

  return `<div class="hlcrf-body" part="body">${body}</div>`;
}

function renderCoreLayoutRegionsForSlot(
  regions: readonly CoreLayoutRegion[],
  slot: CoreLayoutSlot,
): string {
  return regions
    .filter((region) => region.slot === slot)
    .map((region) => renderCoreLayoutRegion(region))
    .join("");
}

function renderCoreLayoutRegion(region: CoreLayoutRegion): string {
  const meta = CORE_LAYOUT_REGION_META[region.slot];
  const nestedLayout = region.regions.length > 0
    ? renderCoreLayoutRegionGroup(
      region.regions,
      region.path,
      region.regions.map((child) => child.slot).join(""),
    )
    : "";

  return `<${meta.tagName} class="hlcrf-region ${meta.className}" role="${meta.role}" data-slot="${
    escapeCoreLayoutAttribute(
      region.path,
    )
  }" data-block="${
    escapeCoreLayoutAttribute(region.path)
  }" part="${meta.part}"><slot name="${
    escapeCoreLayoutAttribute(
      region.path,
    )
  }"></slot>${nestedLayout}</${meta.tagName}>`;
}

function isCoreLayoutSlot(value: string): value is CoreLayoutSlot {
  return CORE_LAYOUT_SLOTS.has(value);
}

function escapeCoreLayoutAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
