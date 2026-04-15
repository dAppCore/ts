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

export interface CoreWasmLoadOptions extends WebAssembly.Imports {
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
      const result = await WebAssembly.instantiateStreaming(source, imports);
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
  const result = await WebAssembly.instantiate(bytes, imports);
  return {
    module: result.module,
    instance: result.instance,
    exports: result.instance.exports,
  };
}
