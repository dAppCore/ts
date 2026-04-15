import { CoreEventBus, createWailsEventBridge } from "./events.ts";

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

Deno.test("CoreEventBus removeAllListeners aliases offAll", async () => {
  const bus = new CoreEventBus<{ ready: string }>();
  let count = 0;

  bus.on("ready", () => {
    count += 1;
  });
  bus.removeAllListeners("ready");

  await bus.emit("ready", "loaded");

  assert(count === 0, "removeAllListeners should clear the selected bucket");
});

Deno.test("createWailsEventBridge mirrors Wails events into the Core event bus", async () => {
  const sourceHandlers = new Map<
    string,
    (payload: { id: string }) => void | Promise<void>
  >();
  const bridge = createWailsEventBridge<{ "agent.completed": { id: string } }>({
    On(event, handler) {
      sourceHandlers.set(event, handler);
      return () => {
        sourceHandlers.delete(event);
      };
    },
  });

  const seen: Array<{ id: string }> = [];
  const off = bridge.on("agent.completed", (payload) => {
    seen.push(payload);
  });

  await sourceHandlers.get("agent.completed")?.({ id: "run-1" });

  assert(seen.length === 1, "mirrored bridge should receive Wails events");
  assert(seen[0].id === "run-1", "mirrored bridge should preserve the payload");

  off();
  assert(
    !sourceHandlers.has("agent.completed"),
    "source subscriptions should be released when the last listener is removed",
  );
});

Deno.test("createWailsEventBridge emits through the underlying Wails bridge", async () => {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const bridge = createWailsEventBridge<{ "agent.completed": { id: string } }>({
    On() {
      return () => undefined;
    },
    Emit(event, payload) {
      emitted.push({ event, payload });
    },
  });

  const seen: string[] = [];
  bridge.on("agent.completed", (payload) => {
    seen.push(payload.id);
  });

  await bridge.emit("agent.completed", { id: "run-2" });

  assert(seen.length === 1, "bridge emit should still notify local listeners");
  assert(
    seen[0] === "run-2",
    "bridge emit should pass through the local payload",
  );
  assert(emitted.length === 1, "bridge emit should forward the event to Wails");
  assert(
    emitted[0].event === "agent.completed",
    "bridge emit should preserve the event name",
  );
});
