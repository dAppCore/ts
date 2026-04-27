import {
  err,
  isErr,
  isOk,
  ok,
  unwrap,
  unwrapOr,
} from "./result.ts";

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

Deno.test("TestResult_ok_Good", () => {
  const value = ok({ id: 7, label: "demo" });

  assert(isOk(value), "ok() should produce an ok result");
  assert(!isErr(value), "ok() should not produce an error result");
  assertEquals(unwrap(value).id, 7, "unwrap() should return the contained value");
  assertEquals(
    unwrapOr(value, { id: 0, label: "fallback" }).label,
    "demo",
    "unwrapOr() should prefer the contained value",
  );
});

Deno.test("TestResult_err_Bad", () => {
  const failure = new Error("boom");
  const value = err(failure);

  assert(isErr(value), "err() should produce an error result");
  assert(!isOk(value), "err() should not produce an ok result");

  let message = "";
  try {
    unwrap(value);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(message, "boom", "unwrap() should rethrow the original error");
  assertEquals(
    unwrapOr(value, "fallback"),
    "fallback",
    "unwrapOr() should return the fallback when the result is an error",
  );
});

Deno.test("TestResult_unwrap_Ugly", () => {
  const value = err("not-an-error" as unknown as Error);

  let thrown: unknown;
  try {
    unwrap(value);
  } catch (error) {
    thrown = error;
  }

  assertEquals(
    String(thrown),
    "not-an-error",
    "unwrap() should surface malformed error payloads unchanged",
  );
});

