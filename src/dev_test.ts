import { createHmrClientScript } from "./dev.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("TestDev_Reexport_Good", () => {
  const script = createHmrClientScript("/hmr");

  assert(
    script.includes("/hmr"),
    "src/dev.ts should re-export the runtime HMR client helper",
  );
});

