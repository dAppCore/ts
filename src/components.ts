export interface CoreComponentRenderContext {
  readonly connected: boolean;
  readonly shadow: ShadowRoot;
}

export interface CoreComponentOptions {
  shadow?: ShadowRootInit;
}

type FallbackNode = { innerHTML?: string };

const HTMLElementBase = globalThis.HTMLElement ?? class {
  isConnected = false;
  shadowRoot: { innerHTML: string; replaceChildren(...nodes: Array<string | Node>): void } | null = null;

  attachShadow(): { innerHTML: string; replaceChildren(...nodes: Array<string | Node>): void } {
    const shadowRoot = {
      innerHTML: "",
      replaceChildren: (...nodes: Array<string | Node>) => {
        shadowRoot.innerHTML = nodes.map((node) => {
          if (typeof node === "string") {
            return node;
          }
          return (node as FallbackNode).innerHTML ?? "";
        }).join("");
      },
    };
    this.shadowRoot = shadowRoot;
    return shadowRoot;
  }

  remove(): void {
    this.isConnected = false;
    (this as { disconnectedCallback?: () => void }).disconnectedCallback?.();
  }
};
const fallbackCustomElements = new Map<string, CustomElementConstructor>();
let fallbackCreateElementPatched = false;

installFallbackComponentHost();

export abstract class CoreComponent<
  TState extends Record<string, unknown> = Record<string, unknown>,
> extends (HTMLElementBase as typeof HTMLElement) {
  protected readonly shadow: ShadowRoot;
  protected state: TState;

  constructor(
    initialState: TState = {} as TState,
    options: CoreComponentOptions = {},
  ) {
    super();
    this.state = initialState;
    this.shadow = this.attachShadow(options.shadow ?? { mode: "closed" });
  }

  connectedCallback(): void {
    this.render();
    this.onConnect();
  }

  disconnectedCallback(): void {
    this.onDisconnect();
  }

  protected setState(patch: Partial<TState> | ((state: Readonly<TState>) => Partial<TState>)): void {
    const nextPatch = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...nextPatch };
    this.render();
  }

  protected abstract template(context: CoreComponentRenderContext): string | Node | Array<string | Node>;

  protected onConnect(): void {}

  protected onDisconnect(): void {}

  protected render(): void {
    const content = this.template({
      connected: this.isConnected,
      shadow: this.shadow,
    });

    this.shadow.replaceChildren(...flattenRenderOutput(content));
  }
}

export function defineCoreElement(
  tagName: string,
  ctor: CustomElementConstructor,
): void {
  if (typeof customElements !== "undefined") {
    if (!customElements.get(tagName)) {
      customElements.define(tagName, ctor);
    }
    return;
  }

  if (!fallbackCustomElements.has(tagName)) {
    fallbackCustomElements.set(tagName, ctor);
    patchFallbackCreateElement();
  }
}

function flattenRenderOutput(
  value: string | Node | Array<string | Node>,
): Array<string | Node> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenRenderOutput(item));
  }

  if (typeof value === "string") {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return [value];
    }
    return fragmentNodes(value);
  }

  return [value];
}

function fragmentNodes(html: string): Node[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.childNodes);
}

function patchFallbackCreateElement(): void {
  if (fallbackCreateElementPatched || typeof document === "undefined") {
    return;
  }

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const ctor = fallbackCustomElements.get(tagName);
    if (ctor) {
      const element = new ctor() as HTMLElement & {
        connectedCallback?: () => void;
      };
      queueMicrotask(() => {
        element.connectedCallback?.();
      });
      return element;
    }
    return originalCreateElement(tagName, options);
  }) as typeof document.createElement;

  fallbackCreateElementPatched = true;
}

function installFallbackComponentHost(): void {
  if (typeof document !== "undefined") {
    return;
  }

  const fallbackDocument = {
    body: {
      appendChild(node: FallbackElement): FallbackElement {
        node.isConnected = true;
        node.connectedCallback?.();
        return node;
      },
      removeChild(node: FallbackElement): FallbackElement {
        node.isConnected = false;
        node.disconnectedCallback?.();
        return node;
      },
    },
    createElement(tagName: string): unknown {
      if (tagName === "template") {
        return createFallbackTemplate();
      }
      const ctor = fallbackCustomElements.get(tagName);
      if (ctor) {
        const element = new ctor() as FallbackElement;
        queueMicrotask(() => {
          element.connectedCallback?.();
        });
        return element;
      }
      return {
        tagName,
      };
    },
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    enumerable: true,
    value: fallbackDocument,
    writable: true,
  });
}

interface FallbackElement {
  isConnected: boolean;
  connectedCallback?: () => void;
  disconnectedCallback?: () => void;
}

function createFallbackTemplate(): {
  innerHTML: string;
  content: { childNodes: Array<string> };
} {
  let html = "";
  const content = {
    childNodes: [] as Array<string>,
  };

  return {
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
      content.childNodes = [value];
    },
    content,
  };
}
