export * as grpc from "npm:@grpc/grpc-js@^1.12";
export * as protoLoader from "npm:@grpc/proto-loader@^0.7";
export * as openpgp from "npm:openpgp@^6.1.0";

export async function loadHyperswarm(): Promise<unknown> {
  return await import("npm:hyperswarm@^4.8.4");
}
