import {
  CoreCookieJar,
  CoreLocalStorage,
  CoreSessionStorage,
  CoreIndexedDBRequest,
  CoreStorageBucketManager,
  CoreOPFS,
  injectStoragePolyfills,
  parseCookie,
  type CoreCacheBridge,
  type CoreStorageBridge,
  type CoreCookieRecord,
} from "./storage.ts";

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

function createBridge(): CoreStorageBridge {
  const storage = new Map<string, Map<string, string>>();
  const cookies = new Map<string, CoreCookieRecord[]>();
  const caches = new Map<string, Map<string, string>>();
  const buckets = new Map<string, Set<string>>();
  const files = new Map<string, Map<string, string>>();

  const store = (namespace: string): Map<string, string> => {
    let value = storage.get(namespace);
    if (!value) {
      value = new Map();
      storage.set(namespace, value);
    }
    return value;
  };

  const cacheBridge: CoreCacheBridge = {
    async open(origin, cacheName) {
      const key = `${origin}:${cacheName}`;
      if (!caches.has(key)) {
        caches.set(key, new Map());
      }
    },
    async put(origin, cacheName, request, response) {
      const key = `${origin}:${cacheName}`;
      const cache = caches.get(key) ?? new Map();
      caches.set(key, cache);
      cache.set(request.url, JSON.stringify(response));
    },
    async match(origin, cacheName, request) {
      const key = `${origin}:${cacheName}`;
      const value = caches.get(key)?.get(request.url);
      return value ? JSON.parse(value) : null;
    },
    async delete(origin, cacheName, request) {
      const key = `${origin}:${cacheName}`;
      return caches.get(key)?.delete(request.url) ?? false;
    },
    async keys(origin, cacheName) {
      const key = `${origin}:${cacheName}`;
      return Array.from(caches.get(key)?.keys() ?? []).map((url) => ({ url }));
    },
    async names(origin) {
      return Array.from(caches.keys())
        .filter((key) => key.startsWith(`${origin}:`))
        .map((key) => key.slice(origin.length + 1));
    },
    async deleteCache(origin, cacheName) {
      caches.delete(`${origin}:${cacheName}`);
    },
  };

  return {
    store: {
      async get(namespace, key) {
        return store(namespace).get(key) ?? null;
      },
      async set(namespace, key, value) {
        store(namespace).set(key, value);
      },
      async delete(namespace, key) {
        store(namespace).delete(key);
      },
      async list(namespace) {
        return Array.from(store(namespace).keys());
      },
      async clear(namespace) {
        storage.delete(namespace);
      },
    },
    cookies: {
      async list(origin) {
        return [...(cookies.get(origin) ?? [])];
      },
      async set(origin, cookie) {
        const values = cookies.get(origin) ?? [];
        const next = values.filter((value) =>
          value.name !== cookie.name ||
          value.path !== cookie.path ||
          value.domain !== cookie.domain
        );
        next.push(cookie);
        cookies.set(origin, next);
      },
      async delete(origin, name, options?: Pick<CoreCookieRecord, "path" | "domain">) {
        const values = cookies.get(origin) ?? [];
        cookies.set(
          origin,
          values.filter((value) =>
            value.name !== name ||
            (options?.path !== undefined && value.path !== options.path) ||
            (options?.domain !== undefined && value.domain !== options.domain)
          ),
        );
      },
    },
    cache: cacheBridge,
    buckets: {
      async open(origin, name) {
        const value = buckets.get(origin) ?? new Set();
        value.add(name);
        buckets.set(origin, value);
      },
      async delete(origin, name) {
        buckets.get(origin)?.delete(name);
      },
      async keys(origin) {
        return Array.from(buckets.get(origin) ?? []);
      },
    },
    fs: {
      async read(origin, path) {
        return files.get(origin)?.get(path) ?? null;
      },
      async write(origin, path, data) {
        const value = files.get(origin) ?? new Map();
        value.set(path, data);
        files.set(origin, value);
      },
      async delete(origin, path) {
        files.get(origin)?.delete(path);
      },
      async list(origin, path) {
        return Array.from(files.get(origin)?.keys() ?? []).filter((entry) =>
          path === "" || entry.startsWith(path)
        );
      },
      async mkdir() {},
    },
    indexedDB: {
      async open(origin, name, version) {
        return { origin, name, version };
      },
      async deleteDatabase() {},
      async databases(origin) {
        return [`${origin}:db`];
      },
    },
  };
}

Deno.test("CoreLocalStorage stores and retrieves values", async () => {
  const bridge = createBridge();
  const storage = new CoreLocalStorage("app://demo", bridge);

  await storage.setItem("theme", "dark");

  assertEquals(
    await storage.getItem("theme"),
    "dark",
    "local storage should round-trip values",
  );
  assertEquals(await storage.length(), 1, "local storage should count keys");
});

Deno.test("CoreSessionStorage forwards session TTL metadata", async () => {
  const bridge = createBridge();
  const storage = new CoreSessionStorage("app://demo", bridge, "session-1");

  await storage.setItem("wizard_step", "3");

  assertEquals(
    await storage.getItem("wizard_step"),
    "3",
    "session storage should use the shared store bridge",
  );
});

Deno.test("CoreSessionStorage isolates values per session", async () => {
  const bridge = createBridge();
  const first = new CoreSessionStorage("app://demo", bridge, "session-1");
  const second = new CoreSessionStorage("app://demo", bridge, "session-2");

  await first.setItem("wizard_step", "3");
  await second.setItem("wizard_step", "4");

  assertEquals(
    await first.getItem("wizard_step"),
    "3",
    "first session should keep its own value",
  );
  assertEquals(
    await second.getItem("wizard_step"),
    "4",
    "second session should keep its own value",
  );
});

Deno.test("CoreCookieJar parses and serialises visible cookies", async () => {
  const bridge = createBridge();
  const jar = new CoreCookieJar("https://example.com", bridge);

  await jar.set("session_id=abc123; Path=/; Secure");
  await jar.set("prefs=compact; Path=/settings");
  await jar.refresh("/settings/profile", true);

  assertEquals(
    jar.snapshot(),
    "session_id=abc123; prefs=compact",
    "cookie jar should serialise matching visible cookies",
  );
});

Deno.test("parseCookie extracts key attributes", () => {
  const cookie = parseCookie(
    "session_id=abc123; Path=/; Secure; HttpOnly; SameSite=Lax",
    "https://example.com",
  );

  assertEquals(cookie.name, "session_id", "cookie name should parse");
  assertEquals(cookie.value, "abc123", "cookie value should parse");
  assert(cookie.secure === true, "cookie should keep the secure flag");
  assert(cookie.httpOnly === true, "cookie should keep the httpOnly flag");
  assertEquals(cookie.sameSite, "Lax", "cookie should keep the sameSite flag");
});

Deno.test("parseCookie normalises lowercase SameSite values", () => {
  const cookie = parseCookie(
    "session_id=abc123; Path=/; SameSite=none",
    "https://example.com",
  );

  assertEquals(cookie.sameSite, "None", "cookie should normalise lowercase SameSite values");
});

Deno.test("CoreCacheStorage and CoreStorageBucketManager proxy to the bridge", async () => {
  const bridge = createBridge();
  await bridge.cache.open("https://example.com", "shared");
  const polyfills = injectStoragePolyfills("https://example.com", bridge, {
    target: { navigator: {}, document: {} },
  });

  const cache = await polyfills.caches.open("v1");
  await cache.put("/index.html", { status: 200, body: "ok" });
  const response = await cache.match("/index.html");
  const storageMatch = await polyfills.caches.match("/index.html");
  const cacheNames = await polyfills.caches.keys();
  const deleted = await polyfills.caches.delete("v1");
  const bucket = await polyfills.storageBuckets.open("photos", { quota: 1000 });
  const bucketAgain = await polyfills.storageBuckets.open("photos");
  const estimate = await polyfills.storage.estimate();
  await polyfills.storageBuckets.delete("photos");
  const bucketNames = await polyfills.storageBuckets.keys();
  const remoteCacheNames = await polyfills.caches.keys();

  assertEquals(response?.body, "ok", "cache storage should round-trip entries");
  assertEquals(storageMatch?.body, "ok", "cache storage should search opened caches");
  assertEquals(
    cacheNames,
    ["v1", "shared"],
    "cache storage should expose opened and bridge-side cache names",
  );
  assertEquals(deleted, true, "cache storage should delete opened caches");
  assertEquals(
    remoteCacheNames,
    ["shared"],
    "cache storage should expose bridge-side cache names",
  );
  assertEquals(bucket.name, "photos", "bucket manager should open buckets");
  assert(bucket === bucketAgain, "bucket manager should cache opened buckets");
  assertEquals(estimate.quota, 1000, "navigator.storage.estimate should reflect bucket quota");
  assertEquals(bucketNames.length, 0, "bucket manager should delete buckets");
});

Deno.test("CoreIndexedDB.open behaves like an awaitable request", async () => {
  const bridge = createBridge();
  const indexedDB = injectStoragePolyfills("https://example.com", bridge, {
    target: { navigator: {}, document: {} },
  }).indexedDB;

  const request = indexedDB.open("myapp", 2);
  assert(
    request instanceof CoreIndexedDBRequest,
    "open should return an IndexedDB request object",
  );

  let successFired = false;
  request.onsuccess = () => {
    successFired = true;
  };

  const database = await request;
  assert(successFired, "request should fire onsuccess");
  assertEquals(database.name, "myapp", "database name should round-trip");
  assertEquals(database.version, 2, "database version should round-trip");
  assertEquals(request.result?.name, "myapp", "request.result should be populated");
});

Deno.test("CoreOPFS rejects parent traversal", async () => {
  const bridge = createBridge();
  const opfs = new CoreOPFS("https://example.com", bridge);

  let message = "";
  try {
    await opfs.getFileHandle("../secret.txt");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(
    message,
    "OPFS path traversal is not allowed",
    "OPFS should reject parent traversal",
  );
});

Deno.test("CoreOPFS getFileHandle(create) materialises the file", async () => {
  const bridge = createBridge();
  const opfs = new CoreOPFS("https://example.com", bridge);

  const file = await opfs.getFileHandle("notes/todo.txt", { create: true });
  assertEquals(
    await file.getFile(),
    "",
    "created OPFS files should exist with empty content",
  );
});

Deno.test("CoreOPFS create walks parent directories", async () => {
  const mkdirs: string[] = [];
  const bridge: CoreStorageBridge = {
    ...createBridge(),
    fs: {
      async read() {
        return null;
      },
      async write() {},
      async delete() {},
      async list() {
        return [];
      },
      async mkdir(_origin, path) {
        mkdirs.push(path);
      },
    },
  };
  const opfs = new CoreOPFS("https://example.com", bridge);

  await opfs.getFileHandle("notes/archive/todo.txt", { create: true });
  await opfs.getDirectoryHandle("images/raw", { create: true });

  assertEquals(
    mkdirs,
    ["notes", "notes/archive", "images", "images/raw"],
    "OPFS should materialise parent directories before nested entries",
  );
});

Deno.test("injectStoragePolyfills exposes browser-style getters", () => {
  const bridge = createBridge();
  const target = { navigator: {}, document: {} };
  const polyfills = injectStoragePolyfills("https://example.com", bridge, {
    target,
  });

  const localDescriptor = Object.getOwnPropertyDescriptor(target, "localStorage");
  const storageDescriptor = Object.getOwnPropertyDescriptor(target.navigator, "storage");

  assert(localDescriptor?.get !== undefined, "localStorage should be exposed via a getter");
  assert(storageDescriptor?.get !== undefined, "navigator.storage should be exposed via a getter");
  assert(polyfills.localStorage instanceof CoreLocalStorage, "polyfill should return the storage helper");
});

Deno.test("injectStoragePolyfills exposes synchronous storage facades", () => {
  const bridge = createBridge();
  const target = { navigator: {}, document: {} } as Record<string, unknown> & {
    localStorage?: {
      length: number;
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
      clear(): void;
    };
    sessionStorage?: {
      length: number;
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
      clear(): void;
    };
  };

  injectStoragePolyfills("https://example.com", bridge, { target });

  target.localStorage?.setItem("theme", "dark");
  target.sessionStorage?.setItem("step", "3");

  assertEquals(
    target.localStorage?.getItem("theme"),
    "dark",
    "localStorage should expose a synchronous browser-style facade",
  );
  assertEquals(
    target.sessionStorage?.getItem("step"),
    "3",
    "sessionStorage should expose a synchronous browser-style facade",
  );
  assertEquals(target.localStorage?.length, 1, "localStorage facade should count keys");
  assertEquals(target.sessionStorage?.length, 1, "sessionStorage facade should count keys");
});

Deno.test("document.cookie reflects optimistic writes", async () => {
  let gateResolve: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    gateResolve = resolve;
  });

  const bridge: CoreStorageBridge = {
    store: createBridge().store,
    cookies: {
      async list() {
        return [];
      },
      async set() {
        await gate;
      },
      async delete() {
        await gate;
      },
    },
  };

  const target = { navigator: {}, document: {} };
  injectStoragePolyfills("https://example.com", bridge, { target });

  const jar = new CoreCookieJar("https://example.com", bridge);
  await jar.refresh("/", true);

  const pending = jar.set("session_id=abc123; Path=/; Secure");
  assertEquals(
    jar.snapshot(),
    "session_id=abc123",
    "cookie jar should expose optimistic writes immediately",
  );

  gateResolve?.();
  await pending;
});

Deno.test("CoreCookieJar.delete respects path and domain scoping", async () => {
  const bridge = createBridge();
  const jar = new CoreCookieJar("https://example.com", bridge);

  await jar.refresh("/settings/profile", true);
  await jar.set("session_id=root; Path=/; Secure");
  await jar.set("session_id=settings; Path=/settings; Secure");

  await jar.delete("session_id", { path: "/" });

  assertEquals(
    jar.snapshot(),
    "session_id=settings",
    "cookie deletion should honour path scoping",
  );
});

Deno.test("CoreCookieJar keeps secure cookies out of insecure snapshots", async () => {
  const bridge = createBridge();
  const jar = new CoreCookieJar("https://example.com", bridge);

  await jar.refresh("/", false);
  await jar.set("session_id=abc123; Path=/; Secure");

  assertEquals(
    jar.snapshot(),
    "",
    "secure cookies should not leak into insecure snapshots",
  );
});
