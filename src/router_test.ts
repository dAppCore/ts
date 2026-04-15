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

Deno.test("CoreRouter prefers bridge query handlers for core:// URLs", async () => {
  const router = new CoreRouter({
    bridge: {
      query(path, query) {
        return `${path}:${query.get("tab")}`;
      },
      dispatch() {
        return "dispatch";
      },
    },
  });

  const result = await router.navigate("core://settings?tab=general");

  assert(result.handled, "core routes should be handled");
  assertEquals(result.value, "settings:general", "bridge query should handle core routes");
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

Deno.test("CoreRouter handles scheme and path registration", async () => {
  const router = new CoreRouter({
    bridge: { dispatch: () => undefined },
  });

  router.handle("core", "settings", (route) => route.href);
  const result = await router.navigate("core://settings");

  assert(result.handled, "scheme/path routes should be handled");
  assertEquals(
    result.value,
    "core://settings",
    "scheme/path registration should normalise to a core route",
  );
});

Deno.test("CoreRouter registerRoute aliases handle", async () => {
  const router = new CoreRouter({
    bridge: { dispatch: () => undefined },
  });

  router.registerRoute("core", "settings", (route) => route.path);
  const result = await router.navigate("core://settings");

  assert(result.handled, "registerRoute should register the same route shape");
  assertEquals(result.value, "settings", "registerRoute should reuse handle semantics");
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

Deno.test("CoreRouter intercepts core:// anchor clicks", async () => {
  let prevented = false;
  const router = new CoreRouter({
    bridge: {
      dispatch(path) {
        return path;
      },
    },
  });

  const linkEvent = {
    button: 0,
    defaultPrevented: false,
    preventDefault() {
      prevented = true;
    },
    target: {
      getAttribute(name: string) {
        return name === "href" ? "core://agent?tab=team" : null;
      },
    },
  };

  const result = await router.handleLinkEvent(linkEvent);

  assert(prevented, "core links should prevent the browser default");
  assert(result?.handled, "core links should be handled by the router");
  assertEquals(result?.path, "agent", "core links should strip the scheme");
  assertEquals(
    result?.query.get("tab"),
    "team",
    "core link queries should be preserved",
  );
});

Deno.test("CoreRouter mount wires hash and link interception together", async () => {
  const seen: string[] = [];
  let hashListener: (() => void) | undefined;
  let clickListener: ((event: {
    button?: number;
    defaultPrevented?: boolean;
    preventDefault(): void;
    target?: unknown;
  }) => void) | undefined;

  const router = new CoreRouter({
    bridge: {
      dispatch(path) {
        seen.push(path);
        return path;
      },
    },
  });

  const detach = router.mount({
    hashTarget: {
      location: { hash: "#/first" },
      addEventListener(_type: "hashchange", listener: () => void) {
        hashListener = listener;
      },
      removeEventListener(_type: "hashchange", _listener: () => void) {
        hashListener = undefined;
      },
    },
    linkTarget: {
      addEventListener(_type: "click", listener: (event) => void) {
        clickListener = listener;
      },
      removeEventListener(_type: "click", _listener: (event) => void) {
        clickListener = undefined;
      },
    },
  });

  await Promise.resolve();
  assertEquals(seen[0], "/first", "mount should navigate immediately");

  hashListener?.();
  await Promise.resolve();
  assertEquals(seen[1], "/first", "hash changes should be wired by mount");

  clickListener?.({
    button: 0,
    defaultPrevented: false,
    preventDefault() {},
    target: {
      getAttribute(name: string) {
        return name === "href" ? "core://settings" : null;
      },
    },
  });
  await Promise.resolve();
  assertEquals(seen[2], "settings", "core link interception should be wired by mount");

  detach();
  assert(hashListener === undefined, "detach should remove hash listeners");
  assert(clickListener === undefined, "detach should remove link listeners");
});
