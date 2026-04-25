import {
  CoreLayout,
  parseCoreLayoutVariant,
  renderCoreLayoutTemplate,
} from "./layout.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function collectRegionPaths(
  regions: ReturnType<typeof parseCoreLayoutVariant>["regions"],
): string[] {
  return regions.flatMap((region) => [
    region.path,
    ...collectRegionPaths(region.regions),
  ]);
}

Deno.test("parseCoreLayoutVariant parses nested RFC-001 slot paths", () => {
  const tree = parseCoreLayoutVariant("H[LC]CF");
  const paths = collectRegionPaths(tree.regions);

  assert(tree.variant === "H[LC]CF", "variant should normalise to uppercase");
  assert(
    JSON.stringify(paths) === JSON.stringify(["H", "H-L", "H-C", "C", "F"]),
    `paths should include nested header slots, got ${JSON.stringify(paths)}`,
  );
});

Deno.test(
  "renderCoreLayoutTemplate emits semantic slots for core-layout",
  () => {
    const html = renderCoreLayoutTemplate("H[LC]CF");

    assert(
      html.includes('data-layout="root"'),
      "template should include root layout marker",
    );
    assert(
      html.includes('data-layout="H"'),
      "template should include nested header layout marker",
    );
    assert(
      html.includes('data-slot="H-L"'),
      "template should include nested left slot",
    );
    assert(
      html.includes('<slot name="H-C"></slot>'),
      "template should include nested content slot",
    );
    assert(
      html.includes('role="banner"'),
      "template should include header landmark role",
    );
    assert(
      html.includes('role="navigation"'),
      "template should include left navigation role",
    );
  },
);

Deno.test(
  "core-layout custom element renders and updates from the variant attribute",
  () => {
    const element = document.createElement("core-layout") as CoreLayout;
    element.setAttribute("variant", "hcf");
    document.body.appendChild(element);

    try {
      assert(
        element.shadowRoot !== null,
        "core-layout should create a shadow root in the fallback host",
      );
      assert(
        element.shadowRoot?.innerHTML.includes('data-variant="HCF"') ?? false,
        "variant attribute should normalise to uppercase",
      );
      assert(
        !(element.shadowRoot?.innerHTML.includes('data-slot="L"') ?? true),
        "HCF should not render the left slot",
      );

      element.setAttribute("variant", "HLCRF");

      assert(
        element.shadowRoot?.innerHTML.includes('data-slot="L"') ?? false,
        "changing the variant should re-render the left slot",
      );
      assert(
        element.shadowRoot?.innerHTML.includes('data-slot="R"') ?? false,
        "changing the variant should re-render the right slot",
      );
    } finally {
      element.remove();
    }
  },
);
