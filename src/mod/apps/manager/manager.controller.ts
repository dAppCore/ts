import { AppManager } from "./manager.service.ts";
import { AppManagerConfig } from "../pkg/config.service.ts";
import { Body, Controller, Get, Query, Post, Logger } from "@danet/core";
import { Tag, ReturnedType } from "@danet/swagger/decorators";
import { ServerResponse } from "../../../interfaces/http.ts";
import { HTTP_STATUS } from "../../../interfaces/status-codes.ts";


@Tag("Apps")
@Controller("apps")
export class AppManagerController {
  log!: any;

  constructor(private apps: AppManager, private appConfig: AppManagerConfig) {
    this.log = new Logger("AppManagerController");
  }

  @Get("installed")
  @ReturnedType(String)
  listApps() {
    return this.appConfig.getConfig();
  }

  @Get("marketplace")
  @ReturnedType(String)
  getMarketPlaceApps(@Query() q?: {dir?: string }) {
    if (q?.dir) {
      return this.apps.getMarketPlaceApps({ dir: q.dir });
    } else {
      return this.apps.getMarketPlaceApps();
    }
  }

  @Post("install")
  @ReturnedType(ServerResponse)
  async installApp(@Body("code") code: string, @Body("pkg") pkg?: string): Promise<ServerResponse> {
    if (await this.apps.installApp(code, pkg)) {
      this.log.log(`App Installed code:${code} pkg:${pkg}`);
      return new ServerResponse(HTTP_STATUS.ACCEPTED, "App Installed");
    } else {
      this.log.error(`Failed to install app code:${code} pkg:${pkg}`);
      return new ServerResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to install app");
    }
  }

  @Post("remove")
  @ReturnedType(Object)
  removeApp(@Body("code") code: string): {success: boolean} {
     if(this.apps.removeApp(code)) {
       return { success: true };
     }else {
       return { success: false };
     }
  }

}

