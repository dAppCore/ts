import { grpc, protoLoader } from "./grpc.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("TestGrpc_Module_Good", () => {
  assert(
    typeof grpc.credentials.createInsecure === "function",
    "runtime/grpc.ts should re-export grpc-js",
  );
  assert(
    typeof protoLoader.loadSync === "function",
    "runtime/grpc.ts should re-export proto-loader",
  );
});

