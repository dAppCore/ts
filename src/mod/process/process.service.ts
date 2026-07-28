import { ProcessManagerRequest } from "./process.interface.ts";
import { ProcessManagerProcess } from "./processManagerProcess.ts";
import { EventEmitter, Injectable } from "@danet/core";

/**
 * Lethean ProcessManager handles all aspects of running external binaries
 * you need to provide the correct binary for the OS, all other host differences are handled for you
 * @example
 * ProcessManager.run(path.join(homeDir, 'Lethean', 'cli', exeFile),args,
 * {
 * 		key: exeFile,
 * 		stdErr: (stdErr: unknown) => console.log(stdErr),
 * 		stdIn: (stdIn: unknown) => console.log(stdIn),
 * 		stdOut: (stdOut: unknown) => console.log(stdOut)
 * 	} as ProcessInterface
 * 	);
 */
@Injectable()
export class ProcessService {
  constructor(private emitter: EventEmitter) {}

  /**
   * Turns on console.log with 1 or 0
   *
   * @type {number}
   * @private
   */
  private static debug = 0;

  /**
   * Keeps record of processes managed by the class
   *
   * @type {{[p: string]: ProcessManagerProcess}}
   * @private
   */
  private static process: { [name: string]: any } = {};

  /**
   * Runs and returns a process output
   * @param command
   * @param args
   */
  async run(command: string, args?: string[]){
    this.add(command, args)
    return await ProcessService.process[command].output()

  }

  /**
   * Starts a long-running process
   * @param command
   * @param args
   */
  start(command: string, args?: string[]){
    if(ProcessService.process[command]){
        return true
    }
    this.add(command, args)
    return ProcessService.process[command].spawn()

  }

  add(command: string, args: string[] = []){
    ProcessService.process[command] = new Deno.Command(command, {args: args})
  }

  list(){
    return Object.keys(ProcessService.process)
  }

  /**
   * Sends a force quit to the src
   *
   * @example ProcessManager.killProcess('letheand.exe')
   * @param {string} key
   */
  public kill(key: string) {
    if (!ProcessService.process[key]) {
      throw new Error(`Can't find process ${key}`);
    }
    delete ProcessService.process[key];
  }

  /**
   * Creates a src record and then starts it...
   * to be expanded as you can do ProcessManager.startProcess('letheand.exe')
   * so starting right away is optional
   *
   * @param {string} command
   * @param args
   * @param {ProcessManagerRequest} options
   * @returns {Promise<void>}
   * @deprecated
   */
  startmm(command: string, args: any, options?: ProcessManagerRequest) {
    if (!args) {
      console.log("No arguments passed to ProcessManager");
      return;
    }

    const cmdArgs = [command];

    for (const arg in args) {
      if (arg === "igd") {
        continue;
      }
        cmdArgs.push(args[arg]);
      // cmdArgs.push(
      //     "--" + arg.replace(/([A-Z])/g, (x) => "-" + x.toLowerCase()) +
      //     (args[arg].length > 1 ? `=${args[arg]}` : ""),
      // );
    }

    if(!options){
      options = {
        key: 'test',
        command: cmdArgs,
        stdErr: (stdErr: unknown) => console.log(stdErr),
        stdIn: (stdIn: unknown) => console.log(stdIn),
        stdOut: (stdOut: unknown) => console.log(stdOut)
      } as ProcessManagerRequest;
    }

    if (options.key && ProcessService.process[options.key]) {
      return this.getProcess(options.key);
    }

    if (ProcessService.debug) {
      console.log("Arguments passed to ProcessManager:", args);
    }


    if (ProcessService.debug) {
      console.log(
        "ProcessManager processed arguments to these:",
        cmdArgs,
      );
    }

    return this.addProcess(options).run();
  }

  /**
   * Adds an external binary to the system so that it can be interacted with
   *
   * @param {ProcessManagerRequest} process
   * @returns {ProcessManagerProcess}
   * @deprecated
   */
  public addProcess(process: ProcessManagerRequest): ProcessManagerProcess {
    if (ProcessService.process && ProcessService.process[process.key]) {
      return ProcessService.process[process.key];
    }
    return ProcessService.process[process.key] = new ProcessManagerProcess(process, this.emitter);
  }

  /**
   * Returns the src for the key, if we know about it
   *
   * @example ProcessManager.getProcess('letheand.exe')
   * @param {string} key
   * @returns {ProcessManagerProcess}
   * @deprecated
   */
  public getProcess(key: string) {
    if (!ProcessService.process[key]) {
      throw new Error(`Can't find process ${key}`);
    }
    return ProcessService.process[key];
  }

  /**
   * Start a src from its key, e.g executable file name
   *
   * @example ProcessManager.startProcess('letheand.exe')
   * @param {string} key
   * @deprecated
   */
  public startProcess(key: string) {
    if (!ProcessService.process[key]) {
      throw new Error(`Can't find process ${key}`);
    }
    //@todo ad a feeder to centralised io handling, eg websocket srv
    ProcessService.process[key].run().catch(console.error);
  }

  /**
   * Stops a src managed by the ProcessManager
   *
   * @example ProcessManager.stopProcess('letheand.exe')
   * @param {string} key
   * @deprecated
   */
  public stopProcess(key: string) {
    if (!ProcessService.process[key]) {
      throw new Error(`Can't find process ${key}`);
    }

    ProcessService.process[key].process.stop();
  }

}
