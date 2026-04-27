import * as mod from "./mod.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("CoreTS module entrypoint exports the browser helpers", () => {
  assert(
    typeof mod.injectElectronShim === "function",
    "electron shim should be exported",
  );
  assert(
    typeof mod.injectStoragePolyfills === "function",
    "storage polyfills should be exported",
  );
  assert(
    typeof mod.injectCoreRuntime === "function",
    "composite preload helper should be exported",
  );
  assert(
    typeof mod.createLocalAuthDance === "function",
    "local auth helper should be exported",
  );
  assert(
    typeof mod.generateTypeScriptSdk === "function",
    "OpenAPI SDK generator should be exported",
  );
  assert(
    typeof mod.CoreDevServer === "function",
    "dev server helper should be exported",
  );
  assert(
    typeof mod.CoreP2PNetwork === "function",
    "P2P network helper should be exported",
  );
  assert(
    typeof mod.CoreCryptoBridge === "function",
    "crypto bridge should be exported",
  );
  assert(
    typeof mod.CoreNatTraversal === "function",
    "NAT traversal helper should be exported",
  );
  assert(
    typeof mod.CoreLayout === "function",
    "core-layout Web Component should be exported",
  );
});
