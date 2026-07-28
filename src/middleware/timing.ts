import { Injectable, DanetMiddleware , HttpContext, NextFunction} from "@danet/core";

/**
 * Response time middleware, wraps the request in a timer and sets the X-Response-Time header
 */
@Injectable()
export class TimingMiddleware implements DanetMiddleware {
  async action(ctx: HttpContext, next: NextFunction) {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    ctx.response.headers.set("X-Response-Time", `${ms}ms`);
  }
}
