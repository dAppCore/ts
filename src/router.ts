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
  dispatch(path: string, query: URLSearchParams): Promise<T> | T;
}

export type RouteHandler<T = unknown> = (
  route: RouteContext,
) => Promise<T> | T;

export interface CoreRouterOptions<T = unknown> {
  bridge: CoreRouteBridge<T>;
  baseURL?: string;
  httpNavigate?: RouteHandler<T>;
}

export interface HashRouterTarget {
  location: Pick<Location, "hash">;
  addEventListener(type: "hashchange", listener: () => void): void;
  removeEventListener(type: "hashchange", listener: () => void): void;
}

const defaultBaseURL = "http://localhost/";

export class CoreRouter<T = unknown> {
  private readonly routes = new Map<string, RouteHandler<T>>();

  constructor(private readonly options: CoreRouterOptions<T>) {}

  handle(target: string, handler: RouteHandler<T>): this {
    const route = this.parse(target);
    this.routes.set(this.routeKey(route.scheme, route.path), handler);
    return this;
  }

  async navigate(target: string): Promise<RouteResult<T>> {
    const route = this.parse(target);
    const handler = this.routes.get(this.routeKey(route.scheme, route.path));

    if (handler) {
      return {
        ...route,
        handled: true,
        value: await handler(route),
      };
    }

    if (route.scheme === "core") {
      return {
        ...route,
        handled: true,
        value: await this.options.bridge.dispatch(route.path, route.query),
      };
    }

    if (this.options.httpNavigate) {
      return {
        ...route,
        handled: true,
        value: await this.options.httpNavigate(route),
      };
    }

    return { ...route, handled: false };
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

  private defaultHashTarget(): HashRouterTarget {
    if (typeof window === "undefined") {
      throw new Error(
        "CoreRouter.attach requires a browser window or explicit target",
      );
    }
    return window as unknown as HashRouterTarget;
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

  private routeKey(scheme: string, path: string): string {
    return `${scheme}:${path}`;
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
