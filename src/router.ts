export interface RouteContext {
  href: string;
  path: string;
  query: URLSearchParams;
  scheme: string;
  url: URL;
}

export interface RouteResult<T = unknown> extends RouteContext {
  handled: boolean;
  value?: T;
}

export interface CoreRouteBridge<T = unknown> {
  query?(path: string, query: URLSearchParams): Promise<T> | T;
  dispatch(path: string, query: URLSearchParams): Promise<T> | T;
}

export type RouteHandler<T = unknown> = (
  route: RouteContext,
) => Promise<T> | T;

export interface CoreRouterOptions<T = unknown> {
  bridge: CoreRouteBridge<unknown>;
  baseURL?: string;
  httpNavigate?: RouteHandler<T>;
}

export interface HashRouterTarget {
  location: Pick<Location, "hash">;
  addEventListener(type: "hashchange", listener: () => void): void;
  removeEventListener(type: "hashchange", listener: () => void): void;
}

export interface CoreRouterLinkEvent {
  button?: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
  preventDefault(): void;
}

export interface CoreRouterLinkTarget {
  addEventListener(
    type: "click",
    listener: (event: CoreRouterLinkEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "click",
    listener: (event: CoreRouterLinkEvent) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface CoreRouterMountOptions {
  hashTarget?: HashRouterTarget;
  linkTarget?: CoreRouterLinkTarget;
  navigateImmediately?: boolean;
}

const defaultBaseURL = "http://localhost/";

export class CoreRouter<T = unknown> {
  private readonly routes = new Map<string, RouteHandler<T>>();

  constructor(private readonly options: CoreRouterOptions<T>) {}

  handle(target: string, handler: RouteHandler<T>): this;
  handle(scheme: string, path: string, handler: RouteHandler<T>): this;
  handle(
    target: string,
    pathOrHandler: string | RouteHandler<T>,
    maybeHandler?: RouteHandler<T>,
  ): this {
    const { route, handler } = this.resolveHandleArgs(
      target,
      pathOrHandler,
      maybeHandler,
    );
    this.routes.set(this.routeKey(route.scheme, route.path), handler);
    return this;
  }

  registerRoute(
    target: string,
    pathOrHandler: string | RouteHandler<T>,
    maybeHandler?: RouteHandler<T>,
  ): this {
    if (typeof pathOrHandler === "function") {
      return this.handle(target, pathOrHandler);
    }
    if (!maybeHandler) {
      throw new Error("CoreRouter.registerRoute requires a route handler");
    }
    return this.handle(target, pathOrHandler, maybeHandler);
  }

  async navigate(target: string): Promise<RouteResult<T>> {
    const route = this.parse(target);
    const handler = this.routes.get(this.routeKey(route.scheme, route.path));

    if (handler) {
      return {
        ...route,
        handled: true,
        value: (await handler(route)) as T,
      };
    }

    if (route.scheme === "core") {
      if (this.options.bridge.query) {
        return {
          ...route,
          handled: true,
          value: (await this.options.bridge.query(route.path, route.query)) as T,
        };
      }
      return {
        ...route,
        handled: true,
        value: (await this.options.bridge.dispatch(route.path, route.query)) as T,
      };
    }

    if (this.options.httpNavigate) {
      return {
        ...route,
        handled: true,
        value: await this.options.httpNavigate(route),
      };
    }

    return {
      ...route,
      handled: true,
      value: (await this.options.bridge.dispatch(route.path, route.query)) as T,
    };

  }

  navigateHash(hash: string): Promise<RouteResult<T>> {
    return this.navigate(this.hashTarget(hash));
  }

  currentHash(location: Pick<Location, "hash">): string {
    return this.hashTarget(location.hash);
  }

  attach(target?: HashRouterTarget, navigateImmediately = true): () => void {
    const resolvedTarget = target ?? this.defaultHashTarget();
    const onHashChange = () => {
      void this.navigateHash(resolvedTarget.location.hash);
    };

    resolvedTarget.addEventListener("hashchange", onHashChange);
    if (navigateImmediately) {
      onHashChange();
    }

    return () => {
      resolvedTarget.removeEventListener("hashchange", onHashChange);
    };
  }

  interceptLinks(target?: CoreRouterLinkTarget): () => void {
    const resolvedTarget = target ?? this.defaultLinkTarget();
    const onClick = (event: CoreRouterLinkEvent) => {
      void this.handleLinkEvent(event);
    };

    resolvedTarget.addEventListener("click", onClick, true);
    return () => {
      resolvedTarget.removeEventListener("click", onClick, true);
    };
  }

  mount(options: CoreRouterMountOptions = {}): () => void {
    const detachHash = this.attach(
      options.hashTarget,
      options.navigateImmediately ?? true,
    );
    const detachLinks = this.interceptLinks(options.linkTarget);

    return () => {
      detachLinks();
      detachHash();
    };
  }

  async handleLinkEvent(event: CoreRouterLinkEvent): Promise<RouteResult<T> | null> {
    if (!this.isPlainLeftClick(event) || event.defaultPrevented) {
      return null;
    }

    const href = this.extractHref(event.target);
    if (!href || !href.startsWith("core://")) {
      return null;
    }

    event.preventDefault();
    return this.navigate(href);
  }

  private defaultHashTarget(): HashRouterTarget {
    if (typeof window === "undefined") {
      throw new Error(
        "CoreRouter.attach requires a browser window or explicit target",
      );
    }
    return window as unknown as HashRouterTarget;
  }

  private defaultLinkTarget(): CoreRouterLinkTarget {
    if (typeof document === "undefined") {
      throw new Error(
        "CoreRouter.interceptLinks requires a browser document or explicit target",
      );
    }
    return document as unknown as CoreRouterLinkTarget;
  }

  private parse(target: string): RouteContext {
    const href = target.trim();
    if (href === "") {
      return this.parse("/");
    }

    if (href.startsWith("core://")) {
      return this.parseCore(href);
    }

    const url = new URL(href, this.options.baseURL ?? defaultBaseURL);
    return {
      href,
      path: normaliseHttpPath(url.pathname),
      query: url.searchParams,
      scheme: url.protocol.replace(":", ""),
      url,
    };
  }

  private parseCore(href: string): RouteContext {
    const url = new URL(href);
    return {
      href,
      path: normaliseCorePath(`${url.host}${url.pathname}`),
      query: url.searchParams,
      scheme: "core",
      url,
    };
  }

  private hashTarget(hash: string): string {
    const value = hash.replace(/^#/, "").trim();
    return value === "" ? "/" : value;
  }

  private isPlainLeftClick(event: CoreRouterLinkEvent): boolean {
    return (event.button ?? 0) === 0 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey;
  }

  private extractHref(target: unknown): string | null {
    if (!target || typeof target !== "object") {
      return null;
    }

    const candidate = target as {
      href?: unknown;
      getAttribute?: (name: string) => string | null;
      closest?: (selector: string) => unknown;
    };

    if (typeof candidate.href === "string" && candidate.href.trim() !== "") {
      return candidate.href;
    }

    if (typeof candidate.getAttribute === "function") {
      const href = candidate.getAttribute("href");
      if (href) {
        return href;
      }
    }

    if (typeof candidate.closest === "function") {
      const closest = candidate.closest("a[href]");
      if (closest && closest !== target) {
        return this.extractHref(closest);
      }
    }

    return null;
  }

  private routeKey(scheme: string, path: string): string {
    return `${scheme}:${path}`;
  }

  private resolveHandleArgs(
    target: string,
    pathOrHandler: string | RouteHandler<T>,
    maybeHandler?: RouteHandler<T>,
  ): { route: RouteContext; handler: RouteHandler<T> } {
    if (typeof pathOrHandler === "function") {
      return {
        route: this.parse(target),
        handler: pathOrHandler,
      };
    }

    if (!maybeHandler) {
      throw new Error("CoreRouter.handle requires a route handler");
    }

    const scheme = target.trim();
    const path = normaliseHandlePath(pathOrHandler);
    const href = scheme.includes("://")
      ? (scheme.endsWith("://") ? `${scheme}${path}` : scheme)
      : `${scheme}://${path}`;
    return {
      route: this.parse(href),
      handler: maybeHandler,
    };
  }
}

function normaliseCorePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function normaliseHttpPath(path: string): string {
  if (path === "") {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function normaliseHandlePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed.startsWith("/")) {
    return trimmed.replace(/^\/+/, "");
  }
  return trimmed;
}
