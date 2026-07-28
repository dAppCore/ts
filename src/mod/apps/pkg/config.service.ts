
import { Injectable, Logger } from "@danet/core";
import {ObjectService} from "../../config/object/object.service.ts";
import {ModIoFsLocalService} from "../../io/fs/local/service.ts";
@Injectable()
export class AppManagerConfig {
  apps!: any;
  log!: Logger;

  constructor(private object: ObjectService,
              private fileSystem: ModIoFsLocalService) {
    this.apps = this.getConfig()
    this.log = new Logger("AppManagerConfig");
  }

  saveConfig(): boolean {
    return this.object.setObject("conf", "installed-apps", JSON.stringify(this.apps));
  }

  getConfig() {
    this.apps = this.object.getObject( "conf",  "installed-apps");

    try {
      this.apps = JSON.parse(this.apps);
    } catch (e) {
      this.apps = {};
      this.log.error(String(e));
      if (!this.fileSystem.isFile("data/objects/conf/installed-apps.json")) {
        this.object.setObject( "conf", "installed-apps",  JSON.stringify(this.apps));
      } else {
        this.log.error("Failed to load config object, but it the storage is present. Please check data/objects/apps/installed.json is valid json, or delete the storage for it to be remade.");
      }

    }
    if (!this.apps) {
      this.apps = {};
    }
    return this.apps;
  }

  addConfigKey(code: string, data: any){
    this.getConfig()
    this.apps[code] = data;
    return this.saveConfig()
  }
  removeConfigKey(code: string){
    this.getConfig()
    delete this.apps[code];
    return this.saveConfig()
  }
}
