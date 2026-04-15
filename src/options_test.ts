import type { CoreOptions } from "./options.ts";

Deno.test("TestOptions_Module_Good", () => {
  // Missing seam: src/options.ts is type-only, so there is no runtime behaviour
  // to assert here beyond the module loading successfully.
  const options: CoreOptions = {
    locale: "en-GB",
    fallbackLocale: "en",
    origin: "app://demo",
    sessionId: "session-1",
    baseURL: "https://example.test/",
  };

  if (options.locale !== "en-GB") {
    throw new Error("CoreOptions should accept locale values");
  }
});

