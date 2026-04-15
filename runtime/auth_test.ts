import {
  createLocalAuthDance,
  isLocalAuthEnvelope,
  openLocalMessage,
  sealLocalMessage,
} from "./auth.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("Local auth envelopes round-trip", async () => {
  const token = await sealLocalMessage("hello world", "/tmp/corets");
  assert(isLocalAuthEnvelope(token), "sealed payload should use the auth envelope");
  const opened = await openLocalMessage(token, "/tmp/corets");
  assert(opened === "hello world", "sealed payload should decrypt");
});

Deno.test("Local auth rejects mismatched roots", async () => {
  const token = await sealLocalMessage("hello world", "/tmp/corets");

  let message = "";
  try {
    await openLocalMessage(token, "/tmp/other");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(
    message === "local auth root mismatch",
    "auth envelopes should be bound to the original root",
  );
});

Deno.test("Local auth dance exposes a reusable helper", async () => {
  const dance = createLocalAuthDance("/tmp/corets");
  const token = await dance.seal("payload");
  const opened = await dance.open(token);

  assert(opened === "payload", "dance helper should round-trip payloads");
  assert(
    (await dance.material).root === "/tmp/corets",
    "material should preserve the configured root",
  );
});
