import { type CoreWasmSource, loadWasm } from "./wasm.ts";

export interface SharedSecretBridgeOptions {
  allocExport?: string;
  freeExport?: string;
  deriveExport?: string;
  lengthExport?: string;
}

export interface SharedSecretDeriver {
  deriveSharedSecret(
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Promise<Uint8Array>;
  close(): void;
}

type SharedSecretExports = Record<string, WebAssembly.ExportValue> & {
  memory: WebAssembly.Memory;
};

export class CoreCryptoBridge implements SharedSecretDeriver {
  private closed = false;

  constructor(
    private readonly exports: SharedSecretExports,
    private readonly options: SharedSecretBridgeOptions = {},
  ) {}

  static async load(
    source: CoreWasmSource,
    imports: WebAssembly.Imports = {},
    options: SharedSecretBridgeOptions = {},
  ): Promise<CoreCryptoBridge> {
    const wasm = await loadWasm<SharedSecretExports>(source, imports);
    if (!(wasm.exports.memory instanceof WebAssembly.Memory)) {
      throw new Error("crypto WASM module must export memory");
    }
    return new CoreCryptoBridge(wasm.exports, options);
  }

  async deriveSharedSecret(
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Promise<Uint8Array> {
    this.assertOpen();

    const alloc = this.resolveAllocator();
    const free = this.resolveFree();
    const derive = this.resolveDeriver();
    const outputLength = this.resolveOutputLength();

    const publicKeyPointer = alloc(publicKey.length);
    const privateKeyPointer = alloc(privateKey.length);
    const outputPointer = alloc(outputLength);

    try {
      this.memory().set(publicKey, publicKeyPointer);
      this.memory().set(privateKey, privateKeyPointer);
      const status = derive(
        publicKeyPointer,
        publicKey.length,
        privateKeyPointer,
        privateKey.length,
        outputPointer,
        outputLength,
      );
      if (status !== 0) {
        throw new Error(`derive_shared_secret failed with status ${status}`);
      }

      return this.memory().slice(outputPointer, outputPointer + outputLength);
    } finally {
      free(publicKeyPointer, publicKey.length);
      free(privateKeyPointer, privateKey.length);
      free(outputPointer, outputLength);
    }
  }

  close(): void {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("crypto bridge is closed");
    }
  }

  private memory(): Uint8Array {
    return new Uint8Array(this.exports.memory.buffer);
  }

  private resolveAllocator(): (size: number) => number {
    const name = this.options.allocExport;
    const exported = (name ? this.exports[name] : undefined) ??
      this.exports.alloc ??
      this.exports.malloc;
    if (typeof exported !== "function") {
      throw new Error("crypto WASM module must export alloc or malloc");
    }
    return exported as (size: number) => number;
  }

  private resolveFree(): (pointer: number, size: number) => void {
    const name = this.options.freeExport;
    const exported = (name ? this.exports[name] : undefined) ??
      this.exports.free;
    if (typeof exported !== "function") {
      return () => undefined;
    }
    return exported as (pointer: number, size: number) => void;
  }

  private resolveDeriver(): (
    publicKeyPointer: number,
    publicKeyLength: number,
    privateKeyPointer: number,
    privateKeyLength: number,
    outputPointer: number,
    outputLength: number,
  ) => number {
    const name = this.options.deriveExport;
    const exported = (name ? this.exports[name] : undefined) ??
      this.exports.derive_shared_secret ??
      this.exports.deriveSharedSecret;
    if (typeof exported !== "function") {
      throw new Error("crypto WASM module must export derive_shared_secret");
    }
    return exported as (
      publicKeyPointer: number,
      publicKeyLength: number,
      privateKeyPointer: number,
      privateKeyLength: number,
      outputPointer: number,
      outputLength: number,
    ) => number;
  }

  private resolveOutputLength(): number {
    const name = this.options.lengthExport;
    const exported = (name ? this.exports[name] : undefined) ??
      this.exports.shared_secret_length ??
      this.exports.sharedSecretLength;
    if (typeof exported === "function") {
      return Number(exported());
    }
    return 32;
  }
}

export async function loadSharedSecretBridge(
  source: CoreWasmSource,
  imports: WebAssembly.Imports = {},
  options: SharedSecretBridgeOptions = {},
): Promise<CoreCryptoBridge> {
  return await CoreCryptoBridge.load(source, imports, options);
}
