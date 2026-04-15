export interface OpenApiDocument {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
  };
  servers?: OpenApiServer[];
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
  paths: Record<string, OpenApiPathItem>;
}

export interface OpenApiServer {
  url: string;
}

export interface OpenApiPathItem {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  put?: OpenApiOperation;
  post?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
  trace?: OpenApiOperation;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiRequestBody {
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
}

export interface OpenApiSchema {
  $ref?: string;
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  format?: string;
  description?: string;
  enum?: Array<string | number | boolean | null>;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  additionalProperties?: boolean | OpenApiSchema;
}

export interface OpenApiOperationDescriptor {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly operation: OpenApiOperation;
}

export interface OpenApiRequestContext {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly query: URLSearchParams;
  readonly body?: unknown;
  readonly spec: OpenApiDocument;
  readonly operation: OpenApiOperation;
}

export interface OpenApiTransport {
  request(context: OpenApiRequestContext): Promise<unknown> | unknown;
}

export interface WailsOpenApiBridge {
  query(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
}

export interface WailsOpenApiTransportOptions {
  channelPrefix?: string;
}

export interface OpenApiClientOptions {
  baseURL?: string;
  transport?: OpenApiTransport;
  fetcher?: typeof fetch;
  headers?: Record<string, string>;
}

export interface OpenApiGeneratedSdkOptions {
  helperImportPath?: string;
  clientName?: string;
}

export interface OpenApiClient {
  readonly spec: OpenApiDocument;
  readonly operations: OpenApiOperationDescriptor[];
  request(operationName: string, input?: OpenApiOperationInput): Promise<unknown>;
  [operationName: string]: unknown;
}

export type OpenApiOperationInput = Record<string, unknown>;

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

export function buildOpenApiClient(
  spec: OpenApiDocument,
  options: OpenApiClientOptions = {},
): OpenApiClient {
  const operations = collectOpenApiOperations(spec);
  const client: Record<string, unknown> = {
    spec,
    operations,
    request(operationName: string, input: OpenApiOperationInput = {}) {
      return invokeOpenApiOperation(spec, operations, operationName, input, options);
    },
  };

  for (const operation of operations) {
    client[operation.name] = (input: OpenApiOperationInput = {}) =>
      invokeOpenApiOperation(spec, operations, operation.name, input, options);
  }

  return client as OpenApiClient;
}

/**
 * Example:
 *   const transport = createWailsOpenApiTransport(wails, { channelPrefix: "core.openapi" });
 *   const client = buildOpenApiClient(spec, { transport });
 *
 * Builds an OpenAPI transport that routes requests through the Wails bridge
 * instead of HTTP, which is the desktop-mode path described in the RFC.
 */
export function createWailsOpenApiTransport(
  bridge: WailsOpenApiBridge,
  options: WailsOpenApiTransportOptions = {},
): OpenApiTransport {
  const channelPrefix = options.channelPrefix ?? "core.openapi";
  return {
    request(context: OpenApiRequestContext): Promise<unknown> | unknown {
      return bridge.query(`${channelPrefix}.${context.operationId}`, context);
    },
  };
}

export function collectOpenApiOperations(
  spec: OpenApiDocument,
): OpenApiOperationDescriptor[] {
  const descriptors: OpenApiOperationDescriptor[] = [];
  const usedNames = new Map<string, number>();

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }

      const baseName = sanitizeIdentifier(
        operation.operationId ?? `${method}_${path.replace(/[{}\/-]+/g, "_")}`,
      );
      const count = usedNames.get(baseName) ?? 0;
      usedNames.set(baseName, count + 1);
      const name = count === 0 ? baseName : `${baseName}_${count + 1}`;

      descriptors.push({
        name,
        method: method.toUpperCase(),
        path,
        operation,
      });
    }
  }

  return descriptors;
}

export async function invokeOpenApiOperation(
  spec: OpenApiDocument,
  operations: OpenApiOperationDescriptor[],
  operationName: string,
  input: OpenApiOperationInput = {},
  options: OpenApiClientOptions = {},
): Promise<unknown> {
  const operation = operations.find((entry) => entry.name === operationName);
  if (!operation) {
    throw new Error(`unknown OpenAPI operation: ${operationName}`);
  }

  const context = buildRequestContext(spec, operation, input, options);
  if (options.transport) {
    return options.transport.request(context);
  }
  return executeFetchRequest(context, options.fetcher ?? fetch);
}

export function generateTypeScriptSdk(
  spec: OpenApiDocument,
  options: OpenApiGeneratedSdkOptions = {},
): string {
  const helperImportPath = options.helperImportPath ?? "./openapi.ts";
  const clientName = sanitizeIdentifier(options.clientName ?? "createClient");
  const operations = collectOpenApiOperations(spec);
  const componentSchemas = spec.components?.schemas ?? {};

  const sections: string[] = [];
  sections.push(`import { buildOpenApiClient, type OpenApiClientOptions } from ${quote(helperImportPath)};`);
  sections.push("");
  sections.push(`export const spec = ${formatJson(spec)} as const;`);
  sections.push("");

  for (const [name, schema] of Object.entries(componentSchemas)) {
    sections.push(`export type ${sanitizeIdentifier(name)} = ${schemaToType(schema, componentSchemas)};`);
  }

  if (Object.keys(componentSchemas).length > 0) {
    sections.push("");
  }

  for (const operation of operations) {
    const inputType = operationInputType(spec, operation);
    const outputType = operationOutputType(spec, operation);
    sections.push(`export type ${operation.name}Input = ${inputType};`);
    sections.push(`export type ${operation.name}Output = ${outputType};`);
  }

  if (operations.length > 0) {
    sections.push("");
  }

  sections.push("export interface Client {");
  for (const operation of operations) {
    sections.push(
      `  ${operation.name}(input?: ${operation.name}Input): Promise<${operation.name}Output>;`,
    );
  }
  sections.push("  request(operationName: string, input?: Record<string, unknown>): Promise<unknown>;");
  sections.push("}");
  sections.push("");
  sections.push(
    `export function ${clientName}(options: OpenApiClientOptions = {}): Client {`,
  );
  sections.push(
    "  return buildOpenApiClient(spec, options) as unknown as Client;",
  );
  sections.push("}");

  return sections.join("\n");
}

function buildRequestContext(
  spec: OpenApiDocument,
  operation: OpenApiOperationDescriptor,
  input: OpenApiOperationInput,
  options: OpenApiClientOptions,
): OpenApiRequestContext {
  const request = resolveRequestShape(spec, operation, input, options);
  return {
    operationId: operation.name,
    method: operation.method,
    path: request.path,
    url: request.url,
    headers: request.headers,
    query: request.query,
    body: request.body,
    spec,
    operation: operation.operation,
  };
}

function resolveRequestShape(
  spec: OpenApiDocument,
  operation: OpenApiOperationDescriptor,
  input: OpenApiOperationInput,
  options: OpenApiClientOptions,
): {
  path: string;
  url: string;
  headers: Record<string, string>;
  query: URLSearchParams;
  body?: unknown;
} {
  const headers = new Map<string, string>();
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    headers.set(key.toLowerCase(), value);
  }

  const parameters = collectParameters(spec, operation);
  const pathValues = new Map<string, string>();
  const query = new URLSearchParams();

  for (const parameter of parameters) {
    const value = readParameterValue(input, parameter);
    if (value === undefined || value === null) {
      if (parameter.required) {
        throw new Error(`missing required parameter: ${parameter.name}`);
      }
      continue;
    }

    switch (parameter.in) {
      case "path":
        pathValues.set(parameter.name, encodeURIComponent(stringifyRequestValue(value)));
        break;
      case "query":
        query.set(parameter.name, stringifyRequestValue(value));
        break;
      case "header":
        headers.set(parameter.name.toLowerCase(), stringifyRequestValue(value));
        break;
      case "cookie":
        break;
    }
  }

  const path = replacePathParameters(operation.path, pathValues);
  const body = resolveRequestBody(operation, input);
  const baseURL = resolveBaseURL(spec, options.baseURL);
  const url = `${baseURL}${path}${query.toString() ? `?${query.toString()}` : ""}`;

  return {
    path,
    url,
    headers: Object.fromEntries(headers),
    query,
    body,
  };
}

function resolveRequestBody(
  operation: OpenApiOperationDescriptor,
  input: OpenApiOperationInput,
): unknown {
  if (!operation.operation.requestBody) {
    return readInputValue(input, "body");
  }

  const candidate = readInputValue(input, "body");
  if (candidate !== undefined) {
    return candidate;
  }

  if (operation.operation.requestBody.required) {
    throw new Error(`missing request body for ${operation.name}`);
  }
  return undefined;
}

function collectParameters(
  spec: OpenApiDocument,
  operation: OpenApiOperationDescriptor,
): OpenApiParameter[] {
  const pathItem = spec.paths[operation.path];
  const parameters = [
    ...(pathItem.parameters ?? []),
    ...(operation.operation.parameters ?? []),
  ];
  const unique = new Map<string, OpenApiParameter>();
  for (const parameter of parameters) {
    unique.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return Array.from(unique.values());
}

function replacePathParameters(
  path: string,
  values: Map<string, string>,
): string {
  return path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values.get(name);
    if (value === undefined) {
      throw new Error(`missing path parameter: ${name}`);
    }
    return value;
  });
}

function resolveBaseURL(spec: OpenApiDocument, override?: string): string {
  const candidate = override ?? spec.servers?.[0]?.url ?? "";
  if (candidate === "") {
    return "";
  }
  return candidate.replace(/\/+$/g, "");
}

async function executeFetchRequest(
  context: OpenApiRequestContext,
  fetcher: typeof fetch,
): Promise<unknown> {
  const headers = new Headers(context.headers);
  const init: RequestInit = {
    method: context.method,
    headers,
  };

  if (context.body !== undefined && context.method !== "GET" && context.method !== "HEAD") {
    if (
      typeof context.body === "string" ||
      context.body instanceof Blob ||
      context.body instanceof FormData ||
      context.body instanceof URLSearchParams ||
      context.body instanceof ArrayBuffer ||
      ArrayBuffer.isView(context.body)
    ) {
      init.body = context.body as BodyInit;
    } else {
      headers.set("content-type", headers.get("content-type") ?? "application/json");
      init.body = JSON.stringify(context.body);
    }
  }

  const response = await fetcher(context.url, init);
  if (!response.ok) {
    throw new Error(`OpenAPI request failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  if (contentType.startsWith("text/") || contentType === "") {
    return response.text();
  }
  return response.arrayBuffer();
}

function readInputValue(input: OpenApiOperationInput, key: string): unknown {
  if (key in input) {
    return input[key];
  }
  return undefined;
}

function readParameterValue(
  input: OpenApiOperationInput,
  parameter: OpenApiParameter,
): unknown {
  const nestedKey = parameter.in === "header" ? "headers" : parameter.in;
  const nested = input[nestedKey];
  if (isRecord(nested) && parameter.name in nested) {
    return nested[parameter.name];
  }
  return readInputValue(input, parameter.name);
}

function stringifyRequestValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function schemaToType(
  schema: OpenApiSchema | undefined,
  components: Record<string, OpenApiSchema>,
): string {
  if (!schema) {
    return "unknown";
  }

  if (schema.$ref) {
    return sanitizeIdentifier(schema.$ref.split("/").pop() ?? "unknown");
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }

  switch (schema.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `${schemaToType(schema.items, components)}[]`;
    case "object":
      return objectSchemaToType(schema, components);
    default:
      break;
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    return schema.oneOf.map((item) => schemaToType(item, components)).join(" | ");
  }
  if (schema.anyOf && schema.anyOf.length > 0) {
    return schema.anyOf.map((item) => schemaToType(item, components)).join(" | ");
  }
  if (schema.allOf && schema.allOf.length > 0) {
    return schema.allOf.map((item) => schemaToType(item, components)).join(" & ");
  }

  return "unknown";
}

function objectSchemaToType(
  schema: OpenApiSchema,
  components: Record<string, OpenApiSchema>,
): string {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(properties);
  const additionalProperties = schema.additionalProperties;

  if (entries.length === 0 && additionalProperties === true) {
    return "Record<string, unknown>";
  }
  if (entries.length === 0 && isOpenApiSchema(additionalProperties)) {
    return `Record<string, ${schemaToType(additionalProperties, components)}>`;
  }

  const lines: string[] = [];
  for (const [name, propertySchema] of entries) {
    const optional = required.has(name) ? "" : "?";
    lines.push(`${JSON.stringify(name)}${optional}: ${schemaToType(propertySchema, components)};`);
  }

  if (additionalProperties === true) {
    lines.push(`[key: string]: unknown;`);
  } else if (isOpenApiSchema(additionalProperties)) {
    lines.push(`[key: string]: ${schemaToType(additionalProperties, components)};`);
  }

  return `{ ${lines.join(" ")} }`;
}

function operationInputType(
  spec: OpenApiDocument,
  operation: OpenApiOperationDescriptor,
): string {
  const parameters = collectParameters(spec, operation);
  const pathParams = parameters.filter((parameter) => parameter.in === "path");
  const queryParams = parameters.filter((parameter) => parameter.in === "query");
  const headerParams = parameters.filter((parameter) => parameter.in === "header");
  const bodyType = operation.operation.requestBody
    ? requestBodyType(operation.operation.requestBody)
    : "unknown";

  const parts: string[] = [];
  if (pathParams.length > 0) {
    parts.push(`path: { ${pathParams.map((parameter) => `${JSON.stringify(parameter.name)}${parameter.required ? "" : "?"}: ${schemaToType(parameter.schema, spec.components?.schemas ?? {})};`).join(" ")} }`);
  }
  if (queryParams.length > 0) {
    parts.push(`query: { ${queryParams.map((parameter) => `${JSON.stringify(parameter.name)}${parameter.required ? "" : "?"}: ${schemaToType(parameter.schema, spec.components?.schemas ?? {})};`).join(" ")} }`);
  }
  if (headerParams.length > 0) {
    parts.push(`headers: { ${headerParams.map((parameter) => `${JSON.stringify(parameter.name)}${parameter.required ? "" : "?"}: ${schemaToType(parameter.schema, spec.components?.schemas ?? {})};`).join(" ")} }`);
  }
  if (operation.operation.requestBody) {
    const optional = operation.operation.requestBody.required ? "" : "?";
    parts.push(`body${optional}: ${bodyType}`);
  }

  return parts.length === 0 ? "Record<string, never>" : `{ ${parts.join(" ")} } & Record<string, unknown>`;
}

function operationOutputType(
  spec: OpenApiDocument,
  operation: OpenApiOperationDescriptor,
): string {
  const responses = operation.operation.responses ?? {};
  const success = responses["200"] ?? responses["201"] ?? responses["202"] ?? responses["204"];
  if (!success?.content) {
    return "unknown";
  }

  const jsonContent = success.content["application/json"] ?? Object.values(success.content)[0];
  return schemaToType(jsonContent?.schema, spec.components?.schemas ?? {});
}

function requestBodyType(requestBody: OpenApiRequestBody): string {
  const content = requestBody.content ?? {};
  const jsonContent = content["application/json"] ?? Object.values(content)[0];
  if (!jsonContent?.schema) {
    return "unknown";
  }
  return schemaToType(jsonContent.schema, {});
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function sanitizeIdentifier(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9_$]+/g, "_")
    .replace(/^(\d)/, "_$1");
  return cleaned.length === 0 ? "generated" : cleaned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOpenApiSchema(value: unknown): value is OpenApiSchema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
