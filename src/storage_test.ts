import {
  CoreCookieJar,
  CoreLocalStorage,
  CoreSessionStorage,
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
        const next = values.filter((value) => value.name !== cookie.name);
        next.push(cookie);
        cookies.set(origin, next);
      },
      async delete(origin, name) {
        const values = cookies.get(origin) ?? [];
        cookies.set(
          origin,
          values.filter((value) => value.name !== name),
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

Deno.test("CoreCacheStorage and CoreStorageBucketManager proxy to the bridge", async () => {
  const bridge = createBridge();
  const polyfills = injectStoragePolyfills("https://example.com", bridge, {
    target: { navigator: {}, document: {} },
  });

  const cache = await polyfills.caches.open("v1");
  await cache.put("/index.html", { status: 200, body: "ok" });
  const response = await cache.match("/index.html");
  const bucket = await polyfills.storageBuckets.open("photos", { quota: 1000 });

  assertEquals(response?.body, "ok", "cache storage should round-trip entries");
  assertEquals(bucket.name, "photos", "bucket manager should open buckets");
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
