import { CoreEventBus } from "./events.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("CoreEventBus emits and removes listeners", async () => {
  const bus = new CoreEventBus<{ "app.ready": string }>();
  const seen: string[] = [];

  const off = bus.on("app.ready", (payload) => {
    seen.push(payload);
  });

  await bus.emit("app.ready", "first");
  off();
  await bus.emit("app.ready", "second");

  assert(seen.length === 1, "listener should be removed");
  assert(seen[0] === "first", "listener should receive the payload");
});

Deno.test("CoreEventBus once listeners fire only once", async () => {
  const bus = new CoreEventBus<{ tick: number }>();
  let count = 0;

  bus.once("tick", () => {
    count++;
  });

  await bus.emit("tick", 1);
  await bus.emit("tick", 2);

  assert(count === 1, "once listener should only fire once");
});
