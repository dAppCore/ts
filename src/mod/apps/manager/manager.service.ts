import { ModIoFsLocalService } from "../../io/fs/local/service.ts";
import { AppManagerInstaller } from "../pkg/installer.service.ts";
import { AppManagerConfig } from "../pkg/config.service.ts";
import { Injectable, Logger } from "@danet/core";

/**
 * Install an app from the Lethean repository
 * @param appName The name of the app to install
 * @param version The version of the app to install
 * @param destination The destination folder to install the app to
 */
@Injectable()
export class AppManager {
  plugin: { code: string; config: string } = {
    code: "lthn-app-settings",
    config:
      "https://raw.githubusercontent.com/letheanVPN/lthn-app-setup/main/lthn.json"
  };
  apps: { [key: string]: string | boolean } = {};
  private config: AppManagerConfig;
  log: any;

  /**
   * Init a plugin on the system
   *
   * @param configService
   * @param fileSystem
   * @param installer
   */
  constructor(private configService: AppManagerConfig,
              private fileSystem: ModIoFsLocalService,
              private installer: AppManagerInstaller
  ) {
    this.apps = this.configService.getConfig();
    this.log = new Logger("AppManager");
  }

  loadPlugin(plugin?: { code: string; config: string }) {
    if (plugin) {
      this.plugin = plugin;
    }


  }

  /**
   * Checks if the package is installed
   *
   * @returns {boolean}
   */
  installed() {
    return this.fileSystem.isDir(
      `apps/${this.plugin.code.split("-").join("/")}`
    );
  }

  /**
   * Install Known Application
   *
   * @param {string} name
   * @param pkg
   * @returns {Promise<any>}
   */
  async installApp(name: string, pkg?: string) {
    if (!this.apps[name]) {
      this.apps[name] = pkg ? pkg : true;
    }
    try {
      this.log.log(`Installing ${name}`);
      return await this.installer.install(name, pkg);
    } catch (e) {
      this.log.error(e);
      return false;
    }
  }

  /**
   * Remove known Application
   *
   * @param {string} name
   * @returns {Promise<any>}
   */
  removeApp(name: string) {
    if (this.apps[name]) {
      try {
        this.installer.uninstall(name);
        this.configService.removeConfigKey(name);
        return true;
      } catch (e) {
        this.log.error(e);
      }
    }
    return false;
  }

  async getMarketPlaceApps(opts?: { dir: string }) {
    let dir = "";
    if (opts && opts.dir) {
      dir = `${opts.dir}/`;
    }
    let url = `https://raw.githubusercontent.com/dAppServer/app-marketplace/main/${dir}index.json`;

    const postReq = await fetch(
      url,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
      try {
        return await postReq.json();
      } catch (e) {
        this.log.error(e);
        return false;
      }

  }
}
