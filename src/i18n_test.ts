import {
  _,
  article,
  CoreI18n,
  type CoreLocaleBridge,
  gerund,
  loadSharedLocale,
  loadTranslations,
  pastTense,
  pluralize,
  registerTranslations,
  resolvePreferredLocale,
  S,
  setLocale,
  setLocaleBridge,
  T,
} from "./i18n.ts";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

Deno.test("CoreI18n translates templates and subjects", () => {
  const i18n = new CoreI18n();
  i18n.register("en", {
    greeting: "Hello, {{.Name}}!",
    "item_count": {
      one: "{{.Count}} item",
      other: "{{.Count}} items",
    },
  });

  assertEquals(
    i18n.T("greeting", { Name: "World" }),
    "Hello, World!",
    "template lookup should interpolate values",
  );
  assertEquals(
    i18n.T("item_count", { Count: 3 }),
    "3 items",
    "plural lookup should select the matching form",
  );
});

Deno.test("CoreI18n built-ins compose helper namespaces", () => {
  assertEquals(
    T("i18n.label.status"),
    "Status:",
    "label namespace should title-case",
  );
  assertEquals(
    T("i18n.progress.build"),
    "Building...",
    "progress namespace should gerund the verb",
  );
  assertEquals(
    T("i18n.count.file", 3),
    "3 files",
    "count namespace should pluralise the noun",
  );
  assertEquals(
    T("i18n.done.delete", "file"),
    "File deleted",
    "done namespace should compose completion text",
  );
  assertEquals(
    T("i18n.fail.delete", "cache"),
    "Failed to delete cache",
    "fail namespace should compose failure text",
  );
});

Deno.test("CoreI18n helper functions are exported", () => {
  const subject = S("file", "config.yaml").Count(2).Formal();
  assert(
    subject.String() === "config.yaml",
    "subject should stringify its value",
  );
  assert(pastTense("delete") === "deleted", "past tense helper should work");
  assert(gerund("build") === "building", "gerund helper should work");
  assert(
    pluralize("child", 2) === "children",
    "plural helper should handle irregular nouns",
  );
  assert(article("apple") === "an", "article helper should detect vowels");

  registerTranslations("test", { greeting: "hi" });
  setLocale("test");
  try {
    assertEquals(
      _("greeting"),
      "hi",
      "registered translations should be used by the default runtime",
    );
  } finally {
    setLocale("en");
  }
});

Deno.test("loadTranslationsFromFile supports file URLs", async () => {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.writeTextFile(path, JSON.stringify({ file_url: "loaded" }));

  try {
    await loadTranslations("file-url", pathToFileURL(path));
    setLocale("file-url");
    assertEquals(
      _("file_url"),
      "loaded",
      "file URL translation sources should load",
    );
  } finally {
    setLocale("en");
    await Deno.remove(path);
  }
});

Deno.test("loadSharedLocale loads from a bridge and locale directory discovery", async () => {
  const bridge: CoreLocaleBridge = {
    async localeGet(locale: string) {
      if (locale !== "bridge-test") {
        return { found: false, content: "" };
      }
      return {
        found: true,
        content: JSON.stringify({ bridged: "loaded" }),
      };
    },
  };

  setLocaleBridge(bridge);
  try {
    const bridged = await loadSharedLocale("bridge-test");
    assert(bridged, "bridge-backed locale should load");
    setLocale("bridge-test");
    try {
      assertEquals(
        _("bridged"),
        "loaded",
        "bridge locale should register translations",
      );
    } finally {
      setLocale("en");
    }
  } finally {
    setLocaleBridge(null);
  }

  const root = await Deno.makeTempDir();
  const localeDir = join(root, ".core", "locales");
  await Deno.mkdir(localeDir, { recursive: true });
  await Deno.writeTextFile(
    join(localeDir, "dir-test.json"),
    JSON.stringify({ directory: "loaded" }),
  );

  const loaded = await loadSharedLocale("dir-test", { localeRoot: localeDir });
  assert(loaded, "filesystem locale discovery should load shared locale files");
  setLocale("dir-test");
  try {
    assertEquals(
      _("directory"),
      "loaded",
      "filesystem locale should register translations",
    );
  } finally {
    setLocale("en");
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("loadSharedLocale_shared_home_locale_Good", async () => {
  const home = await Deno.makeTempDir();
  const localeDir = join(home, ".core", "locales");
  const goStyleLocale = {
    hello: "world",
    nested: {
      title: "Shared locale",
    },
  };

  await Deno.mkdir(localeDir, { recursive: true });
  await Deno.writeTextFile(
    join(localeDir, "en-GB.json"),
    JSON.stringify(goStyleLocale),
  );

  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    const loaded = await loadSharedLocale("en_GB", {
      localeRoot: "~/.core/locales",
    });
    assert(loaded, "shared home locale should load");
    setLocale("en_GB");
    try {
      assertEquals(
        _("hello"),
        "world",
        "shared locale should register translations",
      );
      const goOutput = JSON.parse(
        await Deno.readTextFile(join(localeDir, "en-GB.json")),
      ) as Record<string, unknown>;
      assertEquals(
        Object.keys(goOutput).sort().join(","),
        Object.keys(goStyleLocale).sort().join(","),
        "TypeScript locale loading should preserve the same top-level keys Go returns",
      );
    } finally {
      setLocale("en");
    }
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("resolvePreferredLocale normalises environment locale values", () => {
  assertEquals(
    resolvePreferredLocale({ CORE_LOCALE: "en_US.UTF-8" }),
    "en_US",
    "CORE_LOCALE should keep the language and region",
  );
  assertEquals(
    resolvePreferredLocale({ LANG: "C.UTF-8" }),
    "en",
    "the C locale should fall back to English",
  );
  assertEquals(
    resolvePreferredLocale({ LANG: "POSIX" }),
    "en",
    "POSIX should fall back to English",
  );
  assertEquals(
    resolvePreferredLocale({}),
    "en",
    "missing locale data should fall back to English",
  );
});
