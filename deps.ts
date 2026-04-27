export * as openpgp from "npm:openpgp@^6.1.0";

export async function loadHyperswarm(): Promise<unknown> {
  return await import("npm:hyperswarm@^4.8.4");
}
