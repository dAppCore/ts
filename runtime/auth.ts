import { openpgp } from "../deps.ts";

export interface LocalAuthMaterial {
  root: string;
  fingerprint: string;
  algorithm: string;
  publicKey: string;
  rootPassword: string;
}

export interface LocalAuthEnvelope {
  version: 1;
  root: string;
  fingerprint: string;
  algorithm: string;
  rootPassword?: string;
  cipherText: string;
}

interface LocalAuthState {
  material: LocalAuthMaterial;
  publicKey: Promise<any>;
  privateKey: Promise<any>;
}

const localAuthCache = new Map<string, Promise<LocalAuthState>>();

export async function deriveLocalAuthMaterial(
  root = defaultAuthRoot(),
): Promise<LocalAuthMaterial> {
  return (await getLocalAuthState(root)).material;
}

// Example:
//   const password = await deriveLocalAuthPassword("/workspace/core");
//   // The same root always yields the same password.
export async function deriveLocalAuthPassword(
  root = defaultAuthRoot(),
): Promise<string> {
  return buildLocalAuthPassword(normaliseAuthRoot(root));
}

// Example:
//   const token = await sealLocalMessage("hello", "/workspace/core");
//   const payload = await openLocalMessage(token, "/workspace/core");
export async function sealLocalMessage(
  payload: string,
  root = defaultAuthRoot(),
): Promise<string> {
  const state = await getLocalAuthState(root);
  const message = await openpgp.createMessage({ text: payload });
  const cipherText = await openpgp.encrypt({
    message,
    encryptionKeys: (await state.publicKey) as any,
    format: "armored",
  });

  const envelope: LocalAuthEnvelope = {
    version: 1,
    root: state.material.root,
    fingerprint: state.material.fingerprint,
    algorithm: state.material.algorithm,
    rootPassword: state.material.rootPassword,
    cipherText,
  };
  return `core-auth:${
    bytesToBase64Url(
      new TextEncoder().encode(JSON.stringify(envelope)),
    )
  }`;
}

// Example:
//   const token = await sealLocalMessage("hello", "/workspace/core");
//   await openLocalMessage(token, "/workspace/core");
export async function openLocalMessage(
  token: string,
  root = defaultAuthRoot(),
): Promise<string> {
  const envelope = parseLocalEnvelope(token);
  const state = await getLocalAuthState(root);

  if (envelope.root !== state.material.root) {
    throw new Error("local auth root mismatch");
  }
  if (envelope.fingerprint !== state.material.fingerprint) {
    throw new Error("local auth fingerprint mismatch");
  }
  if (envelope.algorithm !== state.material.algorithm) {
    throw new Error("local auth algorithm mismatch");
  }
  if (
    envelope.rootPassword !== undefined &&
    envelope.rootPassword !== state.material.rootPassword
  ) {
    throw new Error("local auth password mismatch");
  }

  const message = await openpgp.readMessage({
    armoredMessage: envelope.cipherText,
  });
  const decrypted = await openpgp.decrypt({
    message,
    decryptionKeys: (await state.privateKey) as any,
  });

  return typeof decrypted.data === "string"
    ? decrypted.data
    : new TextDecoder().decode(decrypted.data as Uint8Array);
}

// Example:
//   const auth = createLocalAuthDance("/workspace/core");
//   const token = await auth.seal("payload");
//   const payload = await auth.open(token);
export function createLocalAuthDance(root = defaultAuthRoot()): {
  material: Promise<LocalAuthMaterial>;
  seal(payload: string): Promise<string>;
  open(token: string): Promise<string>;
} {
  return {
    material: deriveLocalAuthMaterial(root),
    seal: (payload: string) => sealLocalMessage(payload, root),
    open: (token: string) => openLocalMessage(token, root),
  };
}

export function isLocalAuthEnvelope(value: string): boolean {
  return value.startsWith("core-auth:");
}

function defaultAuthRoot(): string {
  if (typeof Deno !== "undefined" && typeof Deno.cwd === "function") {
    return Deno.cwd();
  }
  return "/";
}

function normaliseAuthRoot(root: string): string {
  return root.trim().replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

async function getLocalAuthState(root: string): Promise<LocalAuthState> {
  const normalisedRoot = normaliseAuthRoot(root);
  let promise = localAuthCache.get(normalisedRoot);
  if (!promise) {
    promise = buildLocalAuthState(normalisedRoot);
    localAuthCache.set(normalisedRoot, promise);
  }
  return promise;
}

async function buildLocalAuthState(root: string): Promise<LocalAuthState> {
  const rootPassword = await buildLocalAuthPassword(root);
  const keyPair = await openpgp.generateKey({
    type: "rsa",
    rsaBits: 2048,
    userIDs: [{ name: `CoreTS ${root}` }],
    passphrase: rootPassword,
    format: "armored",
  });

  const publicKeyBytes = new TextEncoder().encode(keyPair.publicKey);
  const fingerprint = bytesToHex(await sha256Bytes(publicKeyBytes)).slice(
    0,
    32,
  );

  return {
    material: {
      root,
      fingerprint,
      algorithm: "PGP-RSA2048",
      publicKey: keyPair.publicKey,
      rootPassword,
    },
    publicKey: openpgp.readKey({ armoredKey: keyPair.publicKey }),
    privateKey: (async () => {
      const privateKey = await openpgp.readPrivateKey({
        armoredKey: keyPair.privateKey,
      });
      return openpgp.decryptKey({
        privateKey,
        passphrase: rootPassword,
      });
    })(),
  };
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return new Uint8Array(digest);
}

async function buildLocalAuthPassword(root: string): Promise<string> {
  return bytesToHex(await sha256Bytes(new TextEncoder().encode(root)));
}

function parseLocalEnvelope(token: string): LocalAuthEnvelope {
  if (!token.startsWith("core-auth:")) {
    throw new Error("invalid local auth envelope");
  }

  const payload = token.slice("core-auth:".length);
  const json = new TextDecoder().decode(base64UrlToBytes(payload));
  const value = JSON.parse(json) as Partial<LocalAuthEnvelope>;

  if (
    value.version !== 1 ||
    typeof value.root !== "string" ||
    typeof value.fingerprint !== "string" ||
    typeof value.algorithm !== "string" ||
    (value.rootPassword !== undefined &&
      typeof value.rootPassword !== "string") ||
    typeof value.cipherText !== "string"
  ) {
    throw new Error("invalid local auth envelope");
  }

  return value as LocalAuthEnvelope;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalised = `${padded}${"===".slice((padded.length + 3) % 4)}`;
  const binary = atob(normalised);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
