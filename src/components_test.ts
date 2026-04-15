import { CoreComponent, defineCoreElement } from "./components.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

class DemoComponent extends CoreComponent<{ name: string }> {
  constructor() {
    super({ name: "World" }, { shadow: { mode: "open" } });
  }

  protected template(): string {
    return `<span>Hello, <strong>${this.state.name}</strong></span>`;
  }
}

Deno.test("CoreComponent renders HTML templates into the shadow root", () => {
  const tagName = "core-demo-component";
  defineCoreElement(tagName, DemoComponent);

  const element = document.createElement(tagName) as DemoComponent;
  document.body.appendChild(element);

  try {
    assert(element.shadowRoot !== null, "component should create an open shadow root");
    assert(
      element.shadowRoot?.innerHTML === "<span>Hello, <strong>World</strong></span>",
      "string templates should be parsed as HTML",
    );
  } finally {
    element.remove();
  }
});
