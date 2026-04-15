// CoreService gRPC client — Deno calls Go for I/O operations.
// All filesystem, store, and process operations route through this client.

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, "..", "proto", "coredeno.proto");

let packageDef: protoLoader.PackageDefinition | null = null;

function getProto(): any {
  if (!packageDef) {
    packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });
  }
  return grpc.loadPackageDefinition(packageDef).coredeno as any;
}

export interface CoreClient {
  raw: any;
  ping(): Promise<{ ok: boolean }>;
  localeGet(locale: string): Promise<{ found: boolean; content: string }>;
  storeGet(
    group: string,
    key: string,
    moduleCode?: string,
  ): Promise<{ value: string; found: boolean }>;
  storeSet(
    group: string,
    key: string,
    value: string,
    moduleCode?: string,
  ): Promise<{ ok: boolean }>;
  fileRead(path: string, moduleCode: string): Promise<{ content: string }>;
  fileWrite(path: string, content: string, moduleCode: string): Promise<{ ok: boolean }>;
  fileList(path: string, moduleCode: string): Promise<{ entries: Array<{ name: string; is_dir: boolean; size: number }> }>;
  fileDelete(path: string, moduleCode: string): Promise<{ ok: boolean }>;
  processStart(command: string, args: string[], moduleCode: string): Promise<{ process_id: string }>;
  processStop(processId: string, moduleCode: string): Promise<{ ok: boolean }>;
  close(): void;
}

function promisify<T>(client: any, method: string, request: any): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](request, (err: Error | null, response: T) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

export function createCoreClient(socketPath: string): CoreClient {
  const proto = getProto();
  const client = new proto.CoreService(
    `unix://${socketPath}`,
    grpc.credentials.createInsecure(),
  );

  return {
    raw: client,

    ping() {
      return promisify(client, "Ping", {});
    },

    localeGet(locale: string) {
      return promisify(client, "LocaleGet", { locale });
    },

    storeGet(group: string, key: string, moduleCode = "") {
      return promisify(client, "StoreGet", {
        group,
        key,
        module_code: moduleCode,
      });
    },

    storeSet(group: string, key: string, value: string, moduleCode = "") {
      return promisify(client, "StoreSet", {
        group,
        key,
        value,
        module_code: moduleCode,
      });
    },

    fileRead(path: string, moduleCode: string) {
      return promisify(client, "FileRead", { path, module_code: moduleCode });
    },

    fileWrite(path: string, content: string, moduleCode: string) {
      return promisify(client, "FileWrite", { path, content, module_code: moduleCode });
    },

    fileList(path: string, moduleCode: string) {
      return promisify(client, "FileList", { path, module_code: moduleCode });
    },

    fileDelete(path: string, moduleCode: string) {
      return promisify(client, "FileDelete", { path, module_code: moduleCode });
    },

    processStart(command: string, args: string[], moduleCode: string) {
      return promisify(client, "ProcessStart", { command, args, module_code: moduleCode });
    },

    processStop(processId: string, moduleCode: string) {
      return promisify(client, "ProcessStop", {
        process_id: processId,
        module_code: moduleCode,
      });
    },

    close() {
      client.close();
    },
  };
}
