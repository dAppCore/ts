import { decompress } from "https://deno.land/x/zip/mod.ts";
import { Untar } from "@std/archive";
import { copy, readerFromStreamReader } from "@std/io";
import  * as path from "@std/path";
import { EventEmitter, Injectable, Logger } from "@danet/core";
import { ensureDir, ensureDirSync } from "@std/fs"
import { ModIoFsLocalService } from "../../../fs/local/service.ts";
import {DownloadDestination, DownloadedFile} from "./client.interface.ts";



/**
 * @class DownloadService
 * @description
 * Service to download files from the internet
 */
@Injectable()
export class CoreDownloadService {
  log!: Logger;

  constructor(private fileService: ModIoFsLocalService, private emitter: EventEmitter) {
    this.log = new Logger("DownloadService");
  }
  /**
   * Downloads and extracts a zip storage's contents to the dest directory
   *
   * @param {string} url
   * @param {string} dest
   * @returns {Promise<void>}
   */
  async downloadContents(url: string, dest: string) {
    try {
      const filename = url.split("/").pop() ?? "";
      const destination = new DownloadDestination(filename, this.fileService.path(dest));
      this.fileService.ensureDir(destination.dir as string);
      this.log.log(`Attempting to download ${url}`);
      const fileObj = await this.download(
        new URL(url),
        destination,
      );
      this.log.log(`Extracting to: ${destination.dir}`);
    }catch (e) {
      return false
    }
    return true
  }

  /**
   * Downloads a storage to the destination
   *
   * @param {URL} url
   * @param {Destination} destination
   * @param options
   * @returns {Promise<DownloadedFile>}
   */
  async download(
    url: URL,
    destination?: DownloadDestination,
    options?: RequestInit,
  ): Promise<DownloadedFile> {
    let file: string, dir = "", mode = {};

    const response = await fetch(url, options);
    const finalUrl = response.url.replace(/\/$/, "");
    if (response.status != 200) {
      return Promise.reject(
        new Deno.errors.Http(
          `status ${response.status}-'${response.statusText}' received instead of 200`,
        ),
      );
    }

    if (
      typeof destination === "undefined" ||
      typeof destination.dir === "undefined"
    ) {
      dir = Deno.makeTempDirSync({ prefix: "deno_dwld" });
    } else {
      dir = destination.dir;
    }
    if (
      typeof destination === "undefined" ||
      typeof destination.file === "undefined"
    ) {
      file = finalUrl.substring(finalUrl.lastIndexOf("/") + 1);
    } else {
      file = destination.file;
    }
    if (
      typeof destination != "undefined" &&
      typeof destination.mode != "undefined"
    ) {
      mode = { mode: destination.mode };
    }

    dir = dir.replace(/\/$/, "");
    ensureDirSync(dir);
    //const blob = await response.blob();
    const fullPath = `${dir}/${file}`;
    /** size in bytes */
    const size = parseInt(response.headers.get("Content-Length") ?? "0");
    let total = 0;
    for await (const chunk of response.body!) {
      total += chunk.byteLength;
      this.emitter.emit(
        "download",
        JSON.stringify({
          file: file,
          dir: dir,
          fullPath: fullPath,
          size: size,
          total: total,
        }),
      );
      await Deno.writeFile(fullPath, chunk, { append: true });
    }

    if (fullPath.endsWith(".zip")) {
      await decompress(fullPath, dir, { includeFileName: false });
    } else if (fullPath.endsWith(".tar")) {
      const reader = await Deno.open(fullPath, { read: true });
      const untar = new Untar(reader);

      for await (const entry of untar) {
        if (entry.type === "directory") {
          await ensureDir(path.join( dir, entry.fileName));
          continue;
        }

        await Deno.writeFile(
          path.join( dir, entry.fileName),
          new Uint8Array(),
          { mode: 0o777 },
        );
        const file = await Deno.open(
          path.join( dir, entry.fileName),
          { write: true },
        );
        await copy(entry, file);
        file.close()
      }
      reader.close();
    } else if (fullPath.endsWith(".tar.gz")) {
      const reader = await Deno.open(fullPath, { read: true });
      const streamReader = reader.readable
        .pipeThrough(new DecompressionStream("gzip"))
        .getReader();

      const denoReader = readerFromStreamReader(streamReader);
      const untar = new Untar(denoReader);

      for await (const entry of untar) {
        const { fileName, type } = entry;
        if (type === "directory") {
          await ensureDir(path.join( dir, fileName));
          continue;
        }

        await Deno.writeFile(
          path.join( dir, fileName),
          new Uint8Array(),
          { mode: 0o777 },
        );
        const file = await Deno.open(
          path.join( dir, fileName),
          { write: true },
        );
        await copy(entry, file);
        file.close()
      }
      reader.close();
    } else if (fullPath.endsWith(".tar.bz2")) {
      // Deno.run went in Deno 2. Deno.Command takes the binary apart from its
      // arguments, and output() waits for exit rather than needing a separate
      // status() and close().
      const [bin, ...args] = Deno.build.os === "windows"
        ? [
          "PowerShell",
          "Expand-Archive",
          "-Path",
          fullPath,
          "-DestinationPath",
          dir,
        ]
        : ["tar", "xjC", dir, "-f", fullPath];

      const status = await new Deno.Command(bin, {
        args,
        stdout: "inherit",
        stderr: "inherit",
      }).output();
      console.log(status);
    }

    try {
            await Deno.remove(
              fullPath,
              { recursive: true },
            );
    } catch (e) {
      console.error(e);
    }
    //    const buffer = await blob.arrayBuffer();
    //    const unit8arr = new Deno.Buffer(buffer).bytes();

    //Deno.writeFileSync(fullPath, unit8arr, mode);
    return Promise.resolve({ file, dir, fullPath, size });
  }
}
