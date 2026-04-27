import { CoreCryptoBridge } from "./crypto.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertArrayEquals(
  actual: Uint8Array,
  expected: number[],
  message: string,
): void {
  const actualArray = Array.from(actual);
  if (JSON.stringify(actualArray) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actualArray)
      }`,
    );
  }
}

Deno.test("TestCryptoBridge_deriveSharedSecret_Good", async () => {
  const frees: Array<[number, number]> = [];
  let nextPointer = 0;
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new Uint8Array(memory.buffer);
  const bridge = new CoreCryptoBridge({
    memory,
    alloc(size: number) {
      const pointer = nextPointer;
      nextPointer += size;
      return pointer;
    },
    free(pointer: number, size: number) {
      frees.push([pointer, size]);
    },
    derive_shared_secret(
      _publicKeyPointer: number,
      _publicKeyLength: number,
      _privateKeyPointer: number,
      _privateKeyLength: number,
      outputPointer: number,
      outputLength: number,
    ) {
      for (let index = 0; index < outputLength; index++) {
        view[outputPointer + index] = index + 1;
      }
      return 0;
    },
    shared_secret_length() {
      return 4;
    },
  } as any);

  const secret = await bridge.deriveSharedSecret(
    new Uint8Array([1, 2]),
    new Uint8Array([3, 4, 5]),
  );

  assertArrayEquals(secret, [1, 2, 3, 4], "bridge should return the derived secret");
  assertEquals(frees.length, 3, "bridge should free all temporary allocations");
});

Deno.test("TestCryptoBridge_deriveSharedSecret_Bad", async () => {
  const bridge = new CoreCryptoBridge({
    memory: new WebAssembly.Memory({ initial: 1 }),
    derive_shared_secret: () => 0,
  } as any);

  let message = "";
  try {
    await bridge.deriveSharedSecret(
      new Uint8Array([1]),
      new Uint8Array([2]),
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(
    message,
    "crypto WASM module must export alloc or malloc",
    "bridge should reject modules without an allocator",
  );
});

Deno.test("TestCryptoBridge_deriveSharedSecret_Ugly", async () => {
  const bridge = new CoreCryptoBridge({
    memory: new WebAssembly.Memory({ initial: 1 }),
    alloc: (size: number) => size,
    derive_shared_secret: () => 7,
  } as any);

  bridge.close();

  let message = "";
  try {
    await bridge.deriveSharedSecret(
      new Uint8Array([1]),
      new Uint8Array([2]),
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(
    message,
    "crypto bridge is closed",
    "bridge should reject calls after close()",
  );
});

