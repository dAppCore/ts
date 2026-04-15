import {
  buildOpenApiClient,
  collectOpenApiOperations,
  generateTypeScriptSdk,
  type OpenApiClientOptions,
  type OpenApiDocument,
} from "./openapi.ts";

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

Deno.test("collectOpenApiOperations preserves operation ids", () => {
  const spec = demoSpec();
  const operations = collectOpenApiOperations(spec);

  assertEquals(operations.length, 2, "the demo spec should expose two operations");
  assertEquals(operations[0].name, "getUser", "the first operation should keep its operationId");
  assertEquals(operations[1].name, "updateUser", "the second operation should keep its operationId");
});

Deno.test("buildOpenApiClient resolves paths, queries, headers, and bodies", async () => {
  const requests: Array<{
    operationId: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }> = [];

  const spec = demoSpec();
  const options: OpenApiClientOptions = {
    baseURL: "https://api.example.com/v1",
    headers: {
      "x-client": "corets",
    },
    transport: {
      request(context) {
        requests.push({
          operationId: context.operationId,
          method: context.method,
          url: context.url,
          headers: context.headers,
          body: context.body,
        });
        return {
          operationId: context.operationId,
          url: context.url,
        };
      },
    },
  };

  const client = buildOpenApiClient(spec, options);
  const getUser = client.getUser as (
    input: {
      path: { id: string };
      query?: { include?: string };
      headers?: { "x-trace"?: string };
    },
  ) => Promise<{ operationId: string; url: string }>;
  const updateUser = client.updateUser as (
    input: {
      path: { id: string };
      body: { id: string; name: string };
    },
  ) => Promise<unknown>;

  const getResult = await getUser({
    path: { id: "42" },
    query: { include: "summary" },
    headers: { "x-trace": "demo" },
  });
  await updateUser({ path: { id: "42" }, body: { id: "42", name: "Ada" } });

  assertEquals(getResult.operationId, "getUser", "the transport should see the requested operation");
  assertEquals(
    getResult.url,
    "https://api.example.com/v1/users/42?include=summary",
    "the client should expand path and query parameters",
  );
  assertEquals(requests[0].headers["x-client"], "corets", "client headers should be merged into requests");
  assertEquals(requests[0].headers["x-trace"], "demo", "operation headers should be applied to requests");
  assertEquals(requests[1].body && typeof requests[1].body === "object", true, "request bodies should be forwarded");
});

Deno.test("generateTypeScriptSdk emits a standalone client wrapper", () => {
  const source = generateTypeScriptSdk(demoSpec(), {
    helperImportPath: "./openapi.ts",
    clientName: "createDemoClient",
  });

  assert(
    source.includes("export type User ="),
    "generated source should include component schema types",
  );
  assert(
    source.includes("export type getUserInput ="),
    "generated source should include operation input types",
  );
  assert(
    source.includes("export function createDemoClient"),
    "generated source should expose the requested client factory",
  );
  assert(
    source.includes("buildOpenApiClient(spec, options)"),
    "generated source should delegate execution to the runtime helper",
  );
});

function demoSpec(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: "Core demo API",
      version: "1.0.0",
    },
    servers: [
      {
        url: "https://api.example.com/v1/",
      },
    ],
    components: {
      schemas: {
        User: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/users/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: {
          operationId: "getUser",
          parameters: [
            {
              name: "include",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "x-trace",
              in: "header",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
        patch: {
          operationId: "updateUser",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
    },
  };
}
