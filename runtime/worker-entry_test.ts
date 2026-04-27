function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("TestWorkerEntry_Module_Good", async () => {
  await import("./worker-entry.ts");
  assert(true, "worker-entry.ts should import cleanly outside a worker");
});

