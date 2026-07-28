import { Controller, Get, Res } from "@danet/core";
import { Tag } from "@danet/swagger/decorators";
import {ModIoFsLocalService} from "./mod/io/fs/local/service.ts";

/**
 * Main system boot, the aim is to reduce lines and includes here, not functionality.
 * adding is fine, if it MUST go here (more of a note to Snider than reader)
 */
@Controller("")
export class BaseController {

  constructor(private fs: ModIoFsLocalService) {
  }
  @Tag("Info")
  @Get("/h")
  welcomePage(@Res() res: { headers: Headers }): string {
    const file = 'dappui/dist/dappui/browser/index.html'
    if(this.fs.isFile(file)){
        const html = this.fs.read(file);
        res.headers.append( 'Content-Type', 'text/html')
        return html ? html : 'Welcome to the ITW3 API'
    }
    return "Welcome to the ITW3 API";
  }
}
