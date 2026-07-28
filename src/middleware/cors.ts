import {  DanetMiddleware, HttpContext, NextFunction, Injectable } from "@danet/core";
@Injectable()
export class CorsMiddleware implements DanetMiddleware {
  async action(ctx: HttpContext, next: NextFunction) {

    ctx.response.headers.set("Access-Control-Max-Age", "1");
    ctx.response.headers.set("Access-Control-Allow-Origin", `*`);
    ctx.response.headers.set("Access-Control-Allow-Headers", `*`);
    ctx.response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS, HEAD"
    );
    if (ctx.request.method === "OPTIONS") {
      ctx.response.status = 204;
    }
    await next();


  }
}
