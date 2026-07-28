import * as path from "@std/path";
import { Injectable, Logger } from "@danet/core";
import { ensureDir } from "@std/fs";
import {AppManagerConfig} from "./config.service.ts";
import { ObjectService } from "../../config/object/object.service.ts";
import {CoreDownloadService} from "../../io/protocols/http/download/client.service.ts";
import { ModIoFsLocalService } from "../../io/fs/local/service.ts";
import {PluginConfig, PluginType} from "./pkg.interface.ts";

@Injectable()
export class AppManagerInstaller {
  public app: any = [];
  log!: any;

  constructor(
    private configService: AppManagerConfig,
    private object: ObjectService,
    private download: CoreDownloadService,
    private fileSystem: ModIoFsLocalService
  ) {
    this.log = new Logger("AppManagerInstaller");
  }

  /**
   * Attempts to install the package locally
   *
   * @returns {Promise<boolean>}
   */
  async install(name: string, pkg: string) {
    // obviously lots wrong here, i know, validation
    const jsonResponse = await fetch(pkg, { cache: "no-cache" });
    const pluginConfig = (await jsonResponse.json()) as PluginConfig;

    
    if (pluginConfig["code"] == name) {
      this.log.log(
        `Installing ${pluginConfig["name"]} ${pluginConfig["version"]}`
      );
      /**
       * for types bin and core, we are just downloading backend services to be used by te server
       */
      await this.installDependants(pluginConfig);
      await this.installDownload(pluginConfig);
      this.object.setObject(
        "apps",
        pluginConfig["code"],
        JSON.stringify(pluginConfig)
      );

      this.app = {
        name: pluginConfig["name"],
        version: pluginConfig["version"],
        pkg: pkg,
      };

      if (pluginConfig["type"] == "app") {
        this.app["directory"] = this.getAppDirectory(pluginConfig["code"]);

        if (pluginConfig["menu"]) {
          this.installMenu(pluginConfig);
        }
      }
      this.configService.addConfigKey(pluginConfig["code"], this.app);
      this.log.info(
        `Installed ${pluginConfig["name"]} ${pluginConfig["version"]}`
      );
      return true;
    } else {
      this.log.error(
        `Package code miss match. ${pluginConfig["code"]} ${name}`
      );
      throw new Error(
        `Package code miss match. ${pluginConfig["code"]} ${name}`
      );
    }
  }

  /**
   *
   * @param {PluginConfig} plugin
   * @returns {Promise<void>}
   */
  async installDownload(plugin: PluginConfig) {
    if (
      plugin["type"] === PluginType.BIN ||
      plugin["type"] === PluginType.CORE
    ) {
      
      if (plugin["namespace"]) {
        await ensureDir(
          this.fileSystem.path(path.join("data", plugin["namespace"]))
        );
        await ensureDir(
          this.fileSystem.path(path.join("conf", plugin["namespace"]))
        );
      }

      if (
        Deno.build.os === "darwin" &&
        Deno.build.arch == "aarch64" &&
        plugin["downloads"] &&
        !plugin["downloads"]["aarch64"]
      ) {
        this.log.log(
          `Attemping to download: ${
            plugin["downloads"]["x86_64"][Deno.build.os]["url"]
          }`
        );
        return await this.download.downloadContents(
          plugin["downloads"]["x86_64"][Deno.build.os]["url"],
          this.getAppDirectory(plugin["code"])
        );
      } else if (plugin["downloads"]) {
        return await this.download.downloadContents(
          plugin["downloads"][Deno.build.arch][Deno.build.os]["url"],
          this.getAppDirectory(plugin["code"])
        );
      }
    } else if (plugin["type"] && PluginType.APP) {
      if (plugin["downloads"]) {
        await this.download.downloadContents(
          plugin["downloads"]["app"],
          this.getAppDirectory(plugin["code"])
        );
      } else if (plugin["app"]) {
        await this.download.downloadContents(
          plugin["app"]["url"],
          this.getAppDirectory(plugin["code"])
        );
        if (
          plugin["app"]["hooks"] &&
          plugin["app"]["hooks"]["rename"] &&
          plugin["app"]["hooks"]["rename"]["from"] &&
          plugin["app"]["hooks"]["rename"]["to"]
        ) {
          Deno.renameSync(
            `${this.getAppDirectory(plugin["code"])}/${
              plugin["app"]["hooks"]["rename"]["from"]
            }`,
            `${this.getAppDirectory(plugin["code"])}/${
              plugin["app"]["hooks"]["rename"]["to"]
            }`
          );
        }
      }
    } else {
      this.log.error(`Plugin type ${plugin["type"]} not known`);
      console.log("Plugin type not known");
      return false;
    }

    return true;
  }

  installDependants(plugin: PluginConfig) {
    if (plugin["depends"] && plugin["depends"].length > 0) {
      this.log.log(`Installing dependants: ${plugin["depends"].join(", ")}`);
      plugin["depends"].forEach((item: string) => {
        console.log(item);
      });
    }
  }

  /**
   * adds menu entries to application menu
   *
   * @param {PluginConfig} plugin
   * @returns {boolean}
   */
  installMenu(plugin: PluginConfig) {
    let menuSrc = this.object.getObject("conf", "menu") as string;
    if (menuSrc.length > 1) {
      try {
        let menu = JSON.parse(menuSrc);
        if (
          !menu.forEach((item: any) => {
            if (item["title"]) {
              return true;
            }
          })
        ) {
          menu.push({ app: plugin["code"], ...plugin["menu"]["main"] });
        }
        return this.object.setObject("conf", "menu", JSON.stringify(menu));
      } catch (e) {
        this.log.error(String(e));
      }
    } else {
      return this.object.setObject(
        "conf",
        "menu",
        JSON.stringify([{ app: plugin["code"], ...plugin["menu"]["main"] }])
      );
    }
  }

  /**
   * Uninstall user installed application
   *
   * @param {string} code
   * @returns {boolean | boolean}
   */
  uninstall(code: string): boolean {
    if (this.app && this.app["directory"]) {
      this.fileSystem.delete(this.app["directory"]);
      try {
        let menu = JSON.parse(this.object.getObject("conf", "menu") as string);
        let newMenu: string[] = menu.map((item: any) => {
          if (item["title"] !== code) {
            return item;
          }
        });
        return this.object.setObject("conf", menu, JSON.stringify(newMenu));
      } catch (e) {
        this.log.error(String(e));
        return false;
      }
    }

    return false;
  }

  /**
   * Returns the installation directory for a app
   *
   * @param {string} code
   * @returns {string}
   */
  getAppDirectory(code: string) {
    return `apps/${code.split("-").join("/")}`;
  }
}
