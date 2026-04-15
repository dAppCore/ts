export interface CoreComponentRenderContext {
  readonly connected: boolean;
  readonly shadow: ShadowRoot;
}

export interface CoreComponentOptions {
  shadow?: ShadowRootInit;
}

export abstract class CoreComponent<
  TState extends Record<string, unknown> = Record<string, unknown>,
> extends HTMLElement {
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
  if (!customElements.get(tagName)) {
    customElements.define(tagName, ctor);
  }
}

function flattenRenderOutput(
  value: string | Node | Array<string | Node>,
): Array<string | Node> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenRenderOutput(item));
  }

  if (typeof value === "string") {
    return fragmentNodes(value);
  }

  return [value];
}

function fragmentNodes(html: string): Node[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.childNodes);
}
