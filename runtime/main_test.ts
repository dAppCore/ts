import "node:http2";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("TestMain_Module_Good", async () => {
  await import("./main.ts");

  const http2 = await import("node:http2");
  const settings = http2.getDefaultSettings();

  assert(
    settings.enableConnectProtocol === false,
    "runtime/main.ts should import the HTTP2 polyfill before grpc-js",
  );
});

