import  * as path from "@std/path";
import { ensureDirSync } from "@std/fs"
import { Injectable } from "@danet/core";
import DirEntry = Deno.DirEntry;

/**
 * @class
 * @classdesc This class is responsible for handling the storage.
 */
@Injectable()
export class ModIoFsLocalService {
  /**
   * Return a system path to the Lethean folder
   *
   * @param pathname
   * @returns {string}
   */
   path(pathname: any): string {
    if (pathname == undefined) {
      return Deno.cwd();
    }

    if (typeof pathname === "string") {
      pathname = pathname.replace(/\.\./g, ".");
      if (pathname.match("/")) {
        pathname = pathname.split("/");
      } else if (pathname.match("\\\\")) {
        pathname = pathname.split("\\\\");
      } else {
        pathname = [pathname];
      }
    }
    return path.join(Deno.cwd(), ...pathname);
  }

  /**
   * Read a storage from the Lethean folder
   *
   * @openapi
   * /storage/write:
   * post:
   *    description: Reads a storage from the storage
   *
   * @returns {string} | false
   * @param path
   */
   read(path: string) {
    try {
      return Deno.readTextFileSync(this.path(path)) as string;
    } catch (e) {
      return false;
    }
  }

  /**
   * Checks if a directory exists
   *
   * @returns {boolean}
   * @param path
   */
   isDir(path: string) {
    if (path.length == 0) return false;

    try {
      return Deno.statSync(this.path(path)).isDirectory;
    } catch (e) {
      return false;
    }
  }

  /**
   * Checks if a storage exists
   *
   * @returns {boolean}
   * @param path
   */
   isFile(path: string): boolean {
    if (path.length == 0) return false;

    try {
      return Deno.statSync(this.path(path)).isFile;
    } catch (e) {
      return false;
    }
  }

  /**
   *  List all files in a directory  (recursive)
   *
   *  @returns {string[]}
   *  @example
   *   ClientService.list( "./")
   * @param path
   */
   list(path: string): string[] {
    const ret = [];
    try {
      for (
        const dirEntry of Deno.readDirSync(
          this.path(path),
        )
      ) {
        if (!dirEntry.name.startsWith(".")) {
          ret.push(dirEntry.name);
        }
      }
      return ret;
    } catch (e) {
      return [];
    }
  }

   detailedList(path: string): DirEntry[] {
    const ret = [];
    try {
      for (
        const dirEntry of Deno.readDirSync(
          this.path(path),
        )
      ) {
          ret.push(dirEntry);
      }
      return ret;
    } catch (e) {
      return [];
    }
  }

  /**
   * Write to the Lethean data folder
   *
   * @returns boolean
   * @param filepath string
   * @param data string
   */
   write(filepath: string, data: string) {
    try {
      this.ensureDir(path.dirname(filepath));

      Deno.writeTextFileSync(filepath, data);
    } catch (e) {
      return false;
    }

    return true;
  }

  /**
   * Makes sure the directory structure is in place for path
   *
   * @param {string} path relative path to the Lethean folder
   */
   ensureDir(path: string) {
    try {
      ensureDirSync(this.path(path));
    } catch (e) {
      return false;
    }
    return true;
  }

  /**
   * Delete a storage
   *
   * @param filepath string
   * @param recursive
   */
   delete(filepath: string, recursive = true) {
    try {
      const delPath = this.path(filepath);
      // @todo consider changing this, quick add to stop rm /
      if(delPath.length < 3){
        return false;
      }

      Deno.removeSync(delPath, { recursive });
    } catch (e) {
      return false;
    }
    return true;
  }
}
