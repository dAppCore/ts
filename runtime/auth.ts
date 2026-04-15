export interface LocalAuthMaterial {
  root: string;
  fingerprint: string;
}

export interface LocalAuthEnvelope {
  version: 1;
  root: string;
  fingerprint: string;
  iv: string;
  cipherText: string;
}

export async function deriveLocalAuthMaterial(
  root = defaultAuthRoot(),
): Promise<LocalAuthMaterial> {
  const normalisedRoot = normaliseAuthRoot(root);
  const digest = await sha256(normalisedRoot);
  return {
    root: normalisedRoot,
    fingerprint: bytesToHex(digest).slice(0, 32),
  };
}

export async function sealLocalMessage(
  payload: string,
  root = defaultAuthRoot(),
): Promise<string> {
  const material = await deriveLocalAuthMaterial(root);
  const key = await importLocalAuthKey(material.root);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(payload),
  );

  const envelope: LocalAuthEnvelope = {
    version: 1,
    root: material.root,
    fingerprint: material.fingerprint,
    iv: bytesToBase64Url(iv),
    cipherText: bytesToBase64Url(new Uint8Array(cipher)),
  };
  return `core-auth:${bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(envelope)),
  )}`;
}

export async function openLocalMessage(
  token: string,
  root = defaultAuthRoot(),
): Promise<string> {
  const envelope = parseLocalEnvelope(token);
  const material = await deriveLocalAuthMaterial(root);

  if (envelope.fingerprint !== material.fingerprint) {
    throw new Error("local auth fingerprint mismatch");
  }

  const key = await importLocalAuthKey(material.root);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(envelope.iv),
    },
    key,
    base64UrlToBytes(envelope.cipherText),
  );

  return new TextDecoder().decode(plain);
}

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

async function importLocalAuthKey(root: string): Promise<CryptoKey> {
  const raw = await sha256(root);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function sha256(value: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
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
    typeof value.iv !== "string" ||
    typeof value.cipherText !== "string"
  ) {
    throw new Error("invalid local auth envelope");
  }

  return value as LocalAuthEnvelope;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
