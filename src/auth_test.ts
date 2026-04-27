import { isLocalAuthEnvelope } from "./auth.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("TestAuth_Reexport_Good", () => {
  assert(
    isLocalAuthEnvelope("core-auth:payload"),
    "src/auth.ts should re-export the runtime envelope helper",
  );
});

