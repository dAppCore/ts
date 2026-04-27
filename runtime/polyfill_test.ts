import http2 from "node:http2";
import net from "node:net";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("TestPolyfill_Module_Good", async () => {
  await import("./polyfill.ts");

  const settings = http2.getDefaultSettings();
  assert(
    settings.enableConnectProtocol === false,
    "polyfill.ts should replace the not-implemented HTTP2 defaults",
  );
  assert(
    typeof net.connect === "function",
    "polyfill.ts should keep net.connect available after patching",
  );
});

