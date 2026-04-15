import { CoreWasmLoader, loadWasm } from "./wasm.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("CoreWasmLoader instantiates a trivial module", async () => {
  const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const loader = new CoreWasmLoader();
  const instance = await loader.load(bytes);

  assert(instance.module instanceof WebAssembly.Module, "module should be cached");
  assert(instance.instance instanceof WebAssembly.Instance, "instance should be cached");
  assert(loader.current() !== null, "loader should keep the active instance");
});

Deno.test("loadWasm returns the instantiated module", async () => {
  const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const result = await loadWasm(bytes);

  assert(result.exports !== undefined, "exports should be present");
});
