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

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalised = `${padded}${"===".slice((padded.length + 3) % 4)}`;
  return atob(normalised);
}

Deno.test("Local auth envelopes round-trip", async () => {
  const token = await sealLocalMessage("hello world", "/tmp/corets");
  assert(
    isLocalAuthEnvelope(token),
    "sealed payload should use the auth envelope",
  );
  const opened = await openLocalMessage(token, "/tmp/corets");
  assert(opened === "hello world", "sealed payload should decrypt");

  const envelope = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        decodeBase64Url(token.slice("core-auth:".length)),
        (char) => char.charCodeAt(0),
      ),
    ),
  ) as Record<string, unknown>;
  assert(
    !("rootPassword" in envelope),
    "sealed payload should not expose the decryption password",
  );
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
  const material = await dance.material;

  assert(opened === "payload", "dance helper should round-trip payloads");
  assert(
    material.root === "/tmp/corets",
    "material should preserve the configured root",
  );
  assert(
    material.algorithm === "PGP-RSA2048",
    "material should expose the PGP algorithm",
  );
  assert(
    material.publicKey.includes("BEGIN PGP PUBLIC KEY BLOCK"),
    "material should expose an armoured PGP public key",
  );
});
