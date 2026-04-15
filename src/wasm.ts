export interface CoreWasmInstance<TExports extends WebAssembly.Exports = WebAssembly.Exports> {
  module: WebAssembly.Module;
  instance: WebAssembly.Instance;
  exports: TExports;
}

export type CoreWasmSource =
  | ArrayBufferLike
  | Uint8Array
  | Response
  | URL
  | string;

export interface CoreWasmLoadOptions {
  useStreaming?: boolean;
}

export class CoreWasmLoader<TExports extends WebAssembly.Exports = WebAssembly.Exports> {
  private active: CoreWasmInstance<TExports> | null = null;

  async load(
    source: CoreWasmSource,
    imports: WebAssembly.Imports = {},
    options: CoreWasmLoadOptions = {},
  ): Promise<CoreWasmInstance<TExports>> {
    const instance = await instantiateSource(source, imports, options.useStreaming ?? true);
    this.active = instance as CoreWasmInstance<TExports>;
    return this.active;
  }

  current(): CoreWasmInstance<TExports> | null {
    return this.active;
  }

  dispose(): void {
    this.active = null;
  }
}

export async function loadWasm<TExports extends WebAssembly.Exports = WebAssembly.Exports>(
  source: CoreWasmSource,
  imports: WebAssembly.Imports = {},
  options: CoreWasmLoadOptions = {},
): Promise<CoreWasmInstance<TExports>> {
  return instantiateSource(source, imports, options.useStreaming ?? true) as Promise<CoreWasmInstance<TExports>>;
}

/**
 * Example:
 *   const wasm = await loadGoHtmlWasm("/gohtml.wasm");
 *   const exports = wasm.exports as { render(): void };
 *
 * Loads the go-html WASM module using the same instantiation path as the
 * generic loader, but with a name that reflects the actual Core TS surface.
 */
export async function loadGoHtmlWasm<TExports extends WebAssembly.Exports = WebAssembly.Exports>(
  source: CoreWasmSource,
  imports: WebAssembly.Imports = {},
  options: CoreWasmLoadOptions = {},
): Promise<CoreWasmInstance<TExports>> {
  return loadWasm<TExports>(source, imports, options);
}

async function instantiateSource(
  source: CoreWasmSource,
  imports: WebAssembly.Imports,
  useStreaming: boolean,
): Promise<CoreWasmInstance> {
  if (source instanceof WebAssembly.Module) {
    const instance = await WebAssembly.instantiate(source, imports);
    return { module: source, instance, exports: instance.exports };
  }

  if (source instanceof Response) {
    if (useStreaming && typeof WebAssembly.instantiateStreaming === "function") {
      const result = await WebAssembly.instantiateStreaming(
        source,
        imports,
      ) as WebAssembly.WebAssemblyInstantiatedSource;
      return {
        module: result.module,
        instance: result.instance,
        exports: result.instance.exports,
      };
    }
    const bytes = await source.arrayBuffer();
    return instantiateBytes(bytes, imports);
  }

  if (source instanceof URL || typeof source === "string") {
    const response = await fetch(source);
    return instantiateSource(response, imports, useStreaming);
  }

  return instantiateBytes(source, imports);
}

async function instantiateBytes(
  source: ArrayBufferLike | Uint8Array,
  imports: WebAssembly.Imports,
): Promise<CoreWasmInstance> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const result = await WebAssembly.instantiate(
    bytes,
    imports,
  ) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  return {
    module: result.module,
    instance: result.instance,
    exports: result.instance.exports,
  };
}
