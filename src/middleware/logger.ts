import { Injectable, DanetMiddleware , HttpContext, NextFunction, Logger} from "@danet/core";

/**
 * Logger middleware, Please first in the middleware list
 * This logs to the console
 */
@Injectable()
export class LoggerMiddleware implements DanetMiddleware {

  private logger = new Logger('Request');
  async action(ctx: HttpContext, next: NextFunction) {
    await next();
    const reqTime = ctx.response.headers.get("X-Response-Time");
    const reqId = ctx.response.headers.get("X-Response-Id");
    const status = ctx.response.status;
    this.logger.log(`${reqId} ${ctx.request.method} ${ctx.request.url} - ${reqTime} status: ${status}`)
  }
}
