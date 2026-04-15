import { CoreRouter } from "./router.ts";

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

Deno.test("CoreRouter routes core:// URLs through the bridge", async () => {
  const router = new CoreRouter({
    bridge: {
      dispatch(path, query) {
        return `${path}:${query.get("tab")}`;
      },
    },
  });

  const result = await router.navigate("core://settings?tab=general");

  assert(result.handled, "core routes should be handled");
  assertEquals(result.path, "settings", "core path should strip the scheme");
  assertEquals(
    result.value,
    "settings:general",
    "bridge dispatch should receive the stripped path",
  );
});

Deno.test("CoreRouter resolves hash routes through registered handlers", async () => {
  const router = new CoreRouter({
    bridge: { dispatch: () => undefined },
  });

  router.handle("/settings", (route) => route.path);
  const result = await router.navigateHash("#/settings");

  assert(result.handled, "registered hash routes should be handled");
  assertEquals(result.value, "/settings", "hash route should keep its path");
});

Deno.test("CoreRouter falls back to httpNavigate for standard routes", async () => {
  const router = new CoreRouter({
    bridge: { dispatch: () => undefined },
    httpNavigate(route) {
      return route.path;
    },
  });

  const result = await router.navigate("/dashboard");

  assert(result.handled, "httpNavigate should handle standard routes");
  assertEquals(
    result.value,
    "/dashboard",
    "httpNavigate should receive the HTTP path",
  );
});

Deno.test("CoreRouter attach reacts to hash changes", async () => {
  let listener: (() => void) | undefined;
  const seen: string[] = [];

  const router = new CoreRouter({
    bridge: { dispatch: () => undefined },
    httpNavigate(route) {
      seen.push(route.path);
      return route.path;
    },
  });

  const target = {
    location: { hash: "#/first" },
    addEventListener(_type: "hashchange", cb: () => void) {
      listener = cb;
    },
    removeEventListener(_type: "hashchange", _cb: () => void) {
      listener = undefined;
    },
  };

  const detach = router.attach(target, true);
  await Promise.resolve();

  assertEquals(seen[0], "/first", "attach should navigate immediately");

  target.location.hash = "#/second";
  assert(listener !== undefined, "hashchange listener should be registered");
  listener();
  await Promise.resolve();

  assertEquals(seen[1], "/second", "hashchange should trigger navigation");

  detach();
  assert(listener === undefined, "detach should remove the listener");
});
