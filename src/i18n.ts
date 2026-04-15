import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type I18nDictionary = Record<string, unknown>;

export interface I18nSubjectLike {
  readonly Noun: string;
  readonly Value: unknown;
  Count(n: number): I18nSubjectLike;
  Gender(g: string): I18nSubjectLike;
  In(location: string): I18nSubjectLike;
  Formal(): I18nSubjectLike;
  Informal(): I18nSubjectLike;
  SetFormality(formality: I18nFormality): I18nSubjectLike;
  String(): string;
  CountInt(): number;
  GenderString(): string;
  LocationString(): string;
  FormalityString(): I18nFormality;
  IsPlural(): boolean;
}

export type I18nFormality = "neutral" | "formal" | "informal";

export interface I18nOptions {
  locale?: string;
  fallbackLocale?: string;
}

export interface LocaleGetResponse {
  found: boolean;
  content: string;
}

export interface CoreLocaleBridge {
  localeGet(
    locale: string,
  ): Promise<LocaleGetResponse | null | undefined | string>;
}

export interface SharedLocaleOptions {
  bridge?: CoreLocaleBridge;
  localeRoot?: string;
}

type TranslationValue = string | Record<string, unknown>;
type TemplateContext = Record<string, unknown>;

const builtInLocales = new Map<string, I18nDictionary>();
const sharedLocaleRoots = [
  ".core/locales",
  "~/.core/locales",
  "~/.core/locale",
];
let defaultLocaleBridge: CoreLocaleBridge | null = null;

export class CoreI18nSubject implements I18nSubjectLike {
  private count = 1;
  private gender = "";
  private location = "";
  private formality: I18nFormality = "neutral";

  constructor(
    public readonly Noun: string,
    public readonly Value: unknown,
  ) {}

  Count(n: number): I18nSubjectLike {
    this.count = n;
    return this;
  }

  Gender(g: string): I18nSubjectLike {
    this.gender = g;
    return this;
  }

  In(location: string): I18nSubjectLike {
    this.location = location;
    return this;
  }

  Formal(): I18nSubjectLike {
    this.formality = "formal";
    return this;
  }

  Informal(): I18nSubjectLike {
    this.formality = "informal";
    return this;
  }

  SetFormality(formality: I18nFormality): I18nSubjectLike {
    this.formality = formality;
    return this;
  }

  CountInt(): number {
    return this.count;
  }

  GenderString(): string {
    return this.gender;
  }

  LocationString(): string {
    return this.location;
  }

  FormalityString(): I18nFormality {
    return this.formality;
  }

  IsPlural(): boolean {
    return this.count !== 1;
  }

  String(): string {
    return stringValue(this.Value);
  }
}

export class CoreI18n {
  private locale = "en";
  private fallbackLocale = "en";
  private readonly locales = new Map<string, I18nDictionary>();

  constructor(options: I18nOptions = {}) {
    if (options.locale) {
      this.locale = options.locale;
    }
    if (options.fallbackLocale) {
      this.fallbackLocale = options.fallbackLocale;
    }
  }

  register(locale: string, dictionary: I18nDictionary): void {
    this.locales.set(locale, dictionary);
  }

  setLocale(locale: string): void {
    this.locale = locale;
  }

  setFallbackLocale(locale: string): void {
    this.fallbackLocale = locale;
  }

  getLocale(): string {
    return this.locale;
  }

  getFallbackLocale(): string {
    return this.fallbackLocale;
  }

  T(messageID: string, ...args: unknown[]): string {
    return this.translate(messageID, ...args);
  }

  _(messageID: string, ...args: unknown[]): string {
    return this.T(messageID, ...args);
  }

  S(noun: string, value: unknown): CoreI18nSubject {
    return new CoreI18nSubject(noun, value);
  }

  translate(messageID: string, ...args: unknown[]): string {
    const context = this.buildContext(args);

    if (messageID.startsWith("i18n.")) {
      return this.handleNamespace(messageID, context, args);
    }

    const resolved = this.lookup(messageID);
    if (typeof resolved === "string") {
      return renderTemplate(resolved, context, this);
    }
    if (resolved && typeof resolved === "object") {
      const plural = this.pickPlural(
        resolved as Record<string, unknown>,
        context,
      );
      if (typeof plural === "string") {
        return renderTemplate(plural, context, this);
      }
    }
    return renderTemplate(messageID, context, this);
  }

  Raw(messageID: string, ...args: unknown[]): string {
    return this.translate(messageID, ...args);
  }

  PastTense(verb: string): string {
    return pastTense(verb);
  }

  Gerund(verb: string): string {
    return gerund(verb);
  }

  Pluralize(noun: string, count: number): string {
    return pluralize(noun, count);
  }

  Article(word: string): string {
    return article(word);
  }

  ArticlePhrase(word: string): string {
    return `${article(word)} ${word}`;
  }

  N(format: string, value: unknown, ...args: unknown[]): string {
    return formatNumber(format, value, args);
  }

  private lookup(messageID: string): TranslationValue | undefined {
    const locales = [this.locale, this.fallbackLocale];
    for (const locale of locales) {
      const dictionary = this.locales.get(locale) ?? builtInLocales.get(locale);
      const value = lookupPath(dictionary, messageID);
      if (value !== undefined) {
        return value as TranslationValue;
      }
    }
    return undefined;
  }

  private buildContext(args: unknown[]): TemplateContext {
    const context: TemplateContext = {};
    args.forEach((arg, index) => {
      context[`Arg${index}`] = arg;
    });

    for (const arg of args) {
      if (
        typeof arg === "string" || typeof arg === "number" ||
        typeof arg === "boolean"
      ) {
        context.Value = arg;
        context.Subject = stringValue(arg);
        continue;
      }
      if (isSubject(arg)) {
        context.Subject = arg.String();
        context.Noun = arg.Noun;
        context.Value = arg.Value;
        context.Count = arg.CountInt();
        context.Gender = arg.GenderString();
        context.Location = arg.LocationString();
        context.Formality = arg.FormalityString();
        context.IsPlural = arg.IsPlural();
        continue;
      }
      if (isRecord(arg)) {
        Object.assign(context, arg);
      }
    }

    if (context.Count === undefined) {
      context.Count = 1;
    }
    return context;
  }

  private handleNamespace(
    messageID: string,
    context: TemplateContext,
    args: unknown[],
  ): string {
    const parts = messageID.split(".");
    const scope = parts[1] ?? "";
    const key = parts.slice(2).join(".");
    const value = stringValue(args[0] ?? context.Subject ?? key);
    const countSource = typeof args[0] === "number"
      ? args[0]
      : context.Count ?? extractCount(args[0]);
    const count = Number(countSource) || 1;

    switch (scope) {
      case "label":
        return `${titleCase(value)}:`;
      case "progress":
        return `${titleCase(gerund(key || value))}...`;
      case "count":
        return `${count} ${pluralize(key || value, count)}`;
      case "done":
        return doneMessage(key || value, value);
      case "fail":
        return failMessage(key || value, value);
      case "numeric":
        return formatNumber(key, args[0] ?? context.Value, args.slice(1));
      default: {
        const resolved = this.lookup(messageID);
        if (typeof resolved === "string") {
          return renderTemplate(resolved, context, this);
        }
        return messageID;
      }
    }
  }

  private pickPlural(
    value: Record<string, unknown>,
    context: TemplateContext,
  ): string | undefined {
    const count = Number(context.Count ?? context.Value ?? 1);
    if (count === 0 && typeof value.zero === "string") {
      return value.zero;
    }
    if (count === 1 && typeof value.one === "string") {
      return value.one;
    }
    if (count === 2 && typeof value.two === "string") {
      return value.two;
    }
    if (count >= 3 && count <= 4 && typeof value.few === "string") {
      return value.few;
    }
    if (count >= 5 && typeof value.many === "string") {
      return value.many;
    }
    if (typeof value.other === "string") {
      return value.other;
    }
    return undefined;
  }
}

export function registerTranslations(
  locale: string,
  dictionary: I18nDictionary,
): void {
  defaultI18n.register(locale, dictionary);
}

export async function loadTranslations(
  locale: string,
  source: string | URL | Response | I18nDictionary,
): Promise<void> {
  if (isDictionary(source)) {
    registerTranslations(locale, source);
    return;
  }

  if (source instanceof Response) {
    registerTranslations(locale, await parseTranslationSource(source));
    return;
  }

  if (source instanceof URL) {
    registerTranslations(locale, await loadTranslationSource(source));
    return;
  }

  try {
    const url = new URL(source);
    registerTranslations(locale, await loadTranslationSource(url));
    return;
  } catch {
    if (
      typeof Deno !== "undefined" && typeof Deno.readTextFile === "function"
    ) {
      registerTranslations(
        locale,
        await parseTranslationSource(await Deno.readTextFile(source)),
      );
      return;
    }
    throw new Error(`unable to load translations from ${source}`);
  }
}

export function loadTranslationsFromText(locale: string, json: string): void {
  registerTranslations(locale, parseTranslationJSON(json));
}

export async function loadTranslationsFromFile(
  locale: string,
  path: string,
): Promise<void> {
  if (typeof Deno === "undefined" || typeof Deno.readTextFile !== "function") {
    throw new Error("Deno file APIs are not available");
  }
  loadTranslationsFromText(locale, await Deno.readTextFile(path));
}

export function setLocaleBridge(bridge: CoreLocaleBridge | null): void {
  defaultLocaleBridge = bridge;
}

export async function loadSharedLocale(
  locale: string,
  options: SharedLocaleOptions = {},
): Promise<boolean> {
  const bridge = options.bridge ?? defaultLocaleBridge;
  if (bridge) {
    const response = await bridge.localeGet(locale);
    if (typeof response === "string") {
      loadTranslationsFromText(locale, response);
      return true;
    }
    if (response?.found && typeof response.content === "string") {
      loadTranslationsFromText(locale, response.content);
      return true;
    }
  }

  const roots = options.localeRoot ? [options.localeRoot] : sharedLocaleRoots;
  if (typeof Deno !== "undefined" && typeof Deno.readTextFile === "function") {
    for (const root of roots) {
      for (const path of localeCandidates(locale, expandHomePath(root))) {
        let json: string;
        try {
          json = await Deno.readTextFile(path);
        } catch {
          // Fall through to the next candidate.
          continue;
        }
        loadTranslationsFromText(locale, json);
        return true;
      }
    }
  }

  return false;
}

export interface PreferredLocaleEnv {
  CORE_LOCALE?: string;
  LANG?: string;
}

// Resolves the preferred locale from environment-style inputs.
export function resolvePreferredLocale(env: PreferredLocaleEnv = {}): string {
  const raw = env.CORE_LOCALE?.trim() || env.LANG?.trim() || "en";
  const candidate = raw.split(".")[0].split("@")[0].trim();
  if (candidate === "" || candidate === "C" || candidate === "POSIX") {
    return "en";
  }
  return candidate;
}

export function setLocale(locale: string): void {
  defaultI18n.setLocale(locale);
}

export function setFallbackLocale(locale: string): void {
  defaultI18n.setFallbackLocale(locale);
}

export function _(messageID: string, ...args: unknown[]): string {
  return defaultI18n._(messageID, ...args);
}

export function T(messageID: string, ...args: unknown[]): string {
  return defaultI18n.T(messageID, ...args);
}

export function S(noun: string, value: unknown): CoreI18nSubject {
  return defaultI18n.S(noun, value);
}

export function pastTense(verb: string): string {
  const irregular: Record<string, string> = {
    build: "built",
    delete: "deleted",
    do: "did",
    go: "went",
    make: "made",
    run: "ran",
    save: "saved",
    send: "sent",
    write: "wrote",
  };
  if (irregular[verb]) {
    return irregular[verb];
  }
  if (verb.endsWith("e")) {
    return `${verb}d`;
  }
  if (verb.endsWith("y") && !/[aeiou]y$/.test(verb)) {
    return `${verb.slice(0, -1)}ied`;
  }
  return `${verb}ed`;
}

export function gerund(verb: string): string {
  const irregular: Record<string, string> = {
    be: "being",
    die: "dying",
    lie: "lying",
    run: "running",
    write: "writing",
  };
  if (irregular[verb]) {
    return irregular[verb];
  }
  if (verb.endsWith("ie")) {
    return `${verb.slice(0, -2)}ying`;
  }
  if (verb.endsWith("e") && !verb.endsWith("ee")) {
    return `${verb.slice(0, -1)}ing`;
  }
  return `${verb}ing`;
}

export function pluralize(noun: string, count: number): string {
  if (count === 1) {
    return noun;
  }
  const irregular: Record<string, string> = {
    child: "children",
    foot: "feet",
    goose: "geese",
    man: "men",
    person: "people",
    tooth: "teeth",
    woman: "women",
  };
  if (irregular[noun]) {
    return irregular[noun];
  }
  if (noun.endsWith("y") && !/[aeiou]y$/.test(noun)) {
    return `${noun.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/.test(noun)) {
    return `${noun}es`;
  }
  return `${noun}s`;
}

export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export function formatNumber(
  format: string,
  value: unknown,
  args: unknown[],
): string {
  const number = toNumber(value);

  switch (format) {
    case "number":
    case "int":
      return new Intl.NumberFormat().format(number);
    case "decimal":
    case "float":
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 20,
      }).format(number);
    case "percent":
    case "pct":
      return `${
        new Intl.NumberFormat(undefined, {
          maximumFractionDigits: 2,
        }).format(number * 100)
      }%`;
    case "bytes":
    case "size":
      return formatBytes(number);
    case "ordinal":
    case "ord":
      return formatOrdinal(number);
    case "ago": {
      const unit = stringValue(args[0] ?? "seconds");
      return `${number} ${pluralize(unit, number)} ago`;
    }
    default:
      return stringValue(value);
  }
}

export const defaultI18n = new CoreI18n();

function isDictionary(value: unknown): value is I18nDictionary {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof Response);
}

async function parseTranslationSource(
  source: Response | string,
): Promise<I18nDictionary> {
  if (typeof source === "string") {
    return parseTranslationJSON(source);
  }

  if (!source.ok) {
    throw new Error(
      `failed to load translations: ${source.status} ${source.statusText}`,
    );
  }

  return parseTranslationJSON(await source.text());
}

async function loadTranslationSource(url: URL): Promise<I18nDictionary> {
  if (url.protocol === "file:") {
    if (
      typeof Deno !== "undefined" && typeof Deno.readTextFile === "function"
    ) {
      return parseTranslationSource(
        await Deno.readTextFile(fileURLToPath(url)),
      );
    }
    throw new Error(`unable to load translations from ${url.toString()}`);
  }

  const response = await fetch(url);
  return parseTranslationSource(response);
}

function localeCandidates(locale: string, rootDir: string): string[] {
  const normalized = locale.trim().replaceAll("_", "-");
  const lower = normalized.toLowerCase();
  const base = normalized.includes("-")
    ? normalized.slice(0, normalized.indexOf("-"))
    : normalized;
  const variants = new Set<string>([
    locale.trim(),
    normalized,
    lower,
    base,
    base.toLowerCase(),
  ]);

  const paths: string[] = [];
  for (const variant of variants) {
    if (!variant) {
      continue;
    }
    paths.push(join(rootDir, `${variant}.json`));
    paths.push(join(rootDir, variant, "index.json"));
  }
  return paths;
}

function expandHomePath(path: string): string {
  if (!path.startsWith("~")) {
    return path;
  }

  if (typeof Deno === "undefined" || typeof Deno.env?.get !== "function") {
    return path;
  }

  const home = Deno.env.get("HOME");
  if (!home) {
    return path;
  }

  if (path === "~") {
    return home;
  }

  return join(home, path.slice(2));
}

function parseTranslationJSON(json: string): I18nDictionary {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("translation file must contain a JSON object");
  }
  return parsed as I18nDictionary;
}

function lookupPath(root: unknown, path: string): unknown {
  if (!root || typeof root !== "object") {
    return undefined;
  }
  const parts = path.split(".");
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function renderTemplate(
  template: string,
  context: TemplateContext,
  i18n: CoreI18n,
): string {
  return template.replace(/{{\s*([^{}]+)\s*}}/g, (_match, expr: string) => {
    const tokens = expr.trim().split(/\s+/);
    if (tokens.length === 0) {
      return "";
    }

    const [head, ...tail] = tokens;
    switch (head) {
      case ".Subject":
      case "Subject":
        return stringValue(context.Subject);
      case ".Count":
      case "Count":
        return stringValue(context.Count);
      case ".Value":
      case "Value":
        return stringValue(context.Value);
      case "title":
        return titleCase(resolveToken(tail[0] ?? "", context, i18n));
      case "lower":
        return resolveToken(tail[0] ?? "", context, i18n).toLowerCase();
      case "upper":
        return resolveToken(tail[0] ?? "", context, i18n).toUpperCase();
      case "quote":
        return `"${resolveToken(tail[0] ?? "", context, i18n)}"`;
      case "plural":
        return pluralize(
          stripQuotes(tail[0] ?? ""),
          toNumber(resolveToken(tail[1] ?? "", context, i18n)),
        );
      case "article":
        return article(stripQuotes(resolveToken(tail[0] ?? "", context, i18n)));
      case "past":
        return pastTense(
          stripQuotes(resolveToken(tail[0] ?? "", context, i18n)),
        );
      case "gerund":
        return gerund(stripQuotes(resolveToken(tail[0] ?? "", context, i18n)));
      default:
        return stringValue(resolveToken(expr, context, i18n));
    }
  });
}

function resolveToken(
  token: string,
  context: TemplateContext,
  i18n: CoreI18n,
): string {
  const trimmed = token.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return stripQuotes(trimmed);
  }
  if (trimmed.startsWith(".")) {
    return stringValue(context[trimmed.slice(1)]);
  }
  if (trimmed in context) {
    return stringValue(context[trimmed]);
  }
  if (trimmed.startsWith("i18n.")) {
    return i18n.T(trimmed);
  }
  return trimmed;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "object" && value !== null && "String" in value) {
    const maybe = value as { String?: () => string };
    if (typeof maybe.String === "function") {
      return maybe.String();
    }
  }
  return String(value);
}

function titleCase(value: string): string {
  if (value === "") {
    return value;
  }
  return value
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.abs(value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: unit === 0 ? 0 : 2,
  }).format(size);
  return `${value < 0 ? "-" : ""}${formatted} ${units[unit]}`;
}

function formatOrdinal(value: number): string {
  const abs = Math.abs(Math.trunc(value));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }
  switch (abs % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return 0;
}

function extractCount(value: unknown): number | undefined {
  if (isSubject(value)) {
    return value.CountInt();
  }
  if (typeof value === "number") {
    return value;
  }
  return undefined;
}

function doneMessage(verb: string, subject: string): string {
  const action = pastTense(verb);
  if (subject === "") {
    return titleCase(action);
  }
  return `${titleCase(subject)} ${action}`;
}

function failMessage(verb: string, subject: string): string {
  const action = verb === "" ? "operation" : verb;
  if (subject === "") {
    return `Failed to ${action}`;
  }
  return `Failed to ${action} ${subject}`;
}

function isSubject(value: unknown): value is I18nSubjectLike {
  return Boolean(
    value && typeof value === "object" &&
      typeof (value as I18nSubjectLike).String === "function" &&
      typeof (value as I18nSubjectLike).Count === "function" &&
      typeof (value as I18nSubjectLike).SetFormality === "function",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
