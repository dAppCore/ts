import { CoreDevServer, createHmrClientScript } from "./dev.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("HMR client script targets the configured endpoint", () => {
  const script = createHmrClientScript("/hmr");
  assert(script.includes("/hmr"), "script should embed the endpoint");
  assert(script.includes("EventSource"), "script should use EventSource");
});

Deno.test("CoreDevServer snapshot reflects configuration", () => {
  const server = new CoreDevServer({ root: "/workspace", hmrPath: "/hmr" });
  const snapshot = server.snapshot();

  assert(snapshot.root === "/workspace", "snapshot should expose the root");
  assert(snapshot.hmrPath === "/hmr", "snapshot should expose the HMR path");
  assert(snapshot.active === false, "server should be idle before start");
});
