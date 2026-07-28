import {Body, Controller, Logger} from "@danet/core";
import {Get, Post} from "@danet/core";
import {ProcessService} from "../../../mod/process/process.service.ts";
import {ApiProperty, ReturnedType, Tag} from "@danet/swagger/decorators";
import {ModIoFsLocalService} from "../../../mod/io/fs/local/service.ts";
import {ServerResponse} from "../../../interfaces/http.ts";
import { CoreDownloadService } from "../../../mod/io/protocols/http/download/client.service.ts";
import * as path from "@std/path";
import {IniService} from "../../../mod/config/ini/ini.service.ts";
export class BlockchainLetheanDaemonStartDTO {
    @ApiProperty()
    configFile: string;
    @ApiProperty()
    dataDir: string;
    @ApiProperty()
    logDir: string;

}

export class BlockchainLetheanRPCDTO {
    @ApiProperty()
    url: string;
    @ApiProperty()
    req: string;

}

export class BlockchainLetheanWalletStartDTO {
    @ApiProperty()
    walletDir: string;
    @ApiProperty()
    rpcBindPort: number;
    @ApiProperty()
    disableRpcLogin: boolean;
}
@Controller("/api/blockchain/lthn/v1/daemon")
@Tag('blockchain-lthn-v1-daemon')
export class BlockchainLTHNV1DaemonController {
    log: Logger;

    constructor(private process: ProcessService,
                private fileSystem: ModIoFsLocalService,
                private download: CoreDownloadService,
                private ini: IniService) {
        this.log = new Logger('CoreDaemonController');
    }

    @Get('')
    @ReturnedType(Object)
    async getDaemonStatus() {
        return {
            status: "running"
        };
    }

    /**
     * @description Start the Lethean Blockchain Daemon
     */
    @Post()
    @ReturnedType(Object)
    async start() {
        const { code } =  await this.process.start('apps/blockchain/lthn/bin/letheand' )
        return { code, msg: "Daemon started" }
    }

    @Post("start")
    @ReturnedType(ServerResponse)
    startDaemon(@Body() body: BlockchainLetheanDaemonStartDTO): ServerResponse {

        let cmd: any = {};

        const configFile = this.fileSystem.path(path.join("conf", "lthn", body.configFile));

        if (!this.fileSystem.isFile(path.join("conf", "lthn", body.configFile))) {
            this.log.log(`Config file ${configFile} not found`);
            if (!this.fileSystem.isDir(path.join("conf", "lthn"))) {
                this.fileSystem.ensureDir(path.join("conf", "lthn"));
            }
            this.fileSystem.write(
                configFile,
                this.ini.stringify({
                    "log-file": body.logDir
                })
            );
        }
        cmd["configFile"] = configFile;
        if (!this.fileSystem.isDir(body.dataDir)) {
            this.fileSystem.ensureDir(body.dataDir);
        }

        if (!this.fileSystem.isDir(body.logDir)) {
            this.fileSystem.ensureDir(body.logDir);
        }

        const exeFile = path.join("apps", 'blockchain', 'lthn', 'bin',`letheand${Deno.build.os === "windows" ? ".exe" : ""}`);

        if (!this.fileSystem.isFile(exeFile)) {
            this.log.error(`Lethean Daemon executable not found: ${exeFile}`);
            return new ServerResponse(404, "Lethean Daemon executable not found, please install the daemon");
        }

        this.process.start(
            this.fileSystem.path(exeFile),
            cmd
        );
        return new ServerResponse(200, "Daemon started");

    }

    @Post("json_rpc")
    @ReturnedType(String)
    async jsonRpc(@Body() body: BlockchainLetheanRPCDTO): Promise<string> {
        let url = "json_rpc";
        if (body["url"]) {
            url = body["url"];
        }

        const postReq = await fetch(
            `http://127.0.0.1:48782/${url}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body["req"])
            }
        );
        return await postReq.text();

    }

    @Post("export")
    exportBlockchain(@Body() body: any) {
        const exeFile = `lethean-blockchain-export${
            Deno.build.os === "windows" ? ".exe" : ""
        }`;
        this.process.start(
            this.fileSystem.path(["apps", 'blockchain', 'lthn', 'bin', exeFile]),
            body
        );
    }

    @Post("import")
    importBlockchain(@Body() body: any) {
        const exeFile = `lethean-blockchain-import${
            Deno.build.os === "windows" ? ".exe" : ""
        }`;
        this.process.start(
            this.fileSystem.path(["apps", 'blockchain', 'lthn', 'bin', exeFile]),
            body
        );
    }

    @Post("download")
    downloadDaemon(@Body() body: any) {
        const urls = {
            'linux': 'https://github.com/letheanVPN/blockchain-iz/releases/latest/download/lethean-cli-linux.tar',
            'windows': 'https://github.com/letheanVPN/blockchain-iz/releases/latest/download/lethean-cli-windows.tar',
            'mac': 'https://github.com/letheanVPN/blockchain-iz/releases/latest/download/lethean-cli-macos.tar'
        }
        if(urls[Deno.build.os]){
            this.download.downloadContents(urls[Deno.build.os], 'apps/blockchain/lthn/bin').catch((err) => {
                console.log(err);
            });
            return {status: 'Download Requested'};
        }else{
            return {status: 'OS not supported'};
        }

    }
    //
    // @Delete()
    // async stopDaemon() {
    //     return {
    //         status: "stopped"
    //     };
    // }
    //
    // @Put()
    // async restartDaemon() {
    //     return {
    //         status: "running"
    //     };
    // }
    //
    // @Get("/info")
    // async getDaemonInfo() {
    //     return {
    //         status: "running",
    //         version: "1.0.0"
    //     };
    // }
    //
    // @Get("/log")
    // async getDaemonLog() {
    //     return {
    //         log: "log"
    //     };
    // }
    //
    // @Get("/log/:id")
    // async getDaemonLogById() {
    //     return {
    //         log: "log"
    //     };
    // }
    //
    // @Get("/log/:id/:line")
    // async getDaemonLogByIdLine() {
    //     return {
    //         log: "log"
    //     };
    // }
    //
    // @Get("/log/:id/:line/:size")
    // async getDaemonLogByIdLineSize() {
    //     return {
    //         log: "log"
    //     };
    // }
    //
    // @Get("/log/:id/:line/:size/:from")
    // async getDaemonLogByIdLineSizeFrom() {
    //     return {
    //         log: "log"
    //     };
    // }
    //
    // @Get("/log/:id/:line/:size/:from/:to")
    // async getDaemonLogByIdLineSizeFromTo() {
    //     return {
    //         log: "log"
    //     };
    // }
    //
    // @Get("/log/:id/:line/:size/:from/:to/:filter")
    // async getDaemonLogByIdLineSizeFromToFilter() {
    //     return {
    //
}