import Mustache from "mustache";
import  * as path from "@std/path";
import { Injectable } from "@danet/core";
import {ModIoFsLocalService} from "../../io/fs/local/service.ts";

@Injectable()
export class ConfigFileService {

  constructor(private fileSystem: ModIoFsLocalService) {}

  /**
   * Render a template storage
   * @param {string} file
   * @param model
   * @returns {Promise<any>}
   */
  public async renderTemplateFile( file: string, model: any ) {
    const modelArg = {
      ...model, // user data
      dir: this.fileSystem.path( "conf"),
    };
    // npm:mustache renders strings only; renderFile was a deno.land/x
    // addition. The read goes through the filesystem service, which is where
    // every other file access in this repository already goes.
    const template = this.fileSystem.read(
      path.join("conf", "templates", file),
    );
    return Mustache.render(String(template ?? ""), modelArg);
  }

  /**
   * Render a template string
   * @param {string} template
   * @param model
   * @returns {Promise<any>}
   */
  public async renderTemplateString( template: string, model: any ) {
    return Mustache.render(template, model);
  }

  /**
   *
   * @param {string} filename
   * @returns {Promise<string | boolean>}
   */
  public loadFile(filename: string) {
    try {
      const file = this.fileSystem.read(path.join("conf", filename));

      return file ? file : false;
    } catch (error) {
      return false;
    }
  }
}
