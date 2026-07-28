import { ProcessManagerRequest } from "./process.interface.ts";
import { TextLineStream } from "@std/streams";
import { EventEmitter } from "@danet/core";

/**
 * Interacts with the external binary directly, handling its stdIn, stdOut and
 * stdErr, and publishing each output line as an event.
 *
 * Migrated from Deno.run, removed in Deno 2, to Deno.Command. The two differ
 * in more than name: Deno.run took the binary and its arguments as one `cmd`
 * array, Deno.Command takes the binary separately; and the child's streams are
 * now web ReadableStreams rather than readers, so lines come off a
 * TextDecoderStream piped into TextLineStream instead of std's readLines,
 * which no longer exists.
 */
export class ProcessManagerProcess {
  private request: ProcessManagerRequest;

  public process: Deno.ChildProcess | undefined;

  /**
   * @param request what to run, and which of its streams to capture
   * @param emitter the application's emitter. Passed in rather than
   *   constructed here: this module used to hold its own `new EventEmitter()`
   *   at module scope, so everything it published went to an instance nothing
   *   else held, and no subscriber ever heard a line.
   */
  constructor(request: ProcessManagerRequest, private emitter: EventEmitter) {
    this.request = request;
  }

  /**
   * Starts the process and pumps its output until it ends.
   */
  public async run(): Promise<Deno.ChildProcess | undefined> {
    // Deno.run took ["bin", "arg", ...]; Deno.Command wants them apart.
    const [bin, ...args] = Array.isArray(this.request.command)
      ? this.request.command
      : [this.request.command];

    try {
      const command = new Deno.Command(bin, {
        args,
        stdin: this.request.stdIn ? "piped" : "null",
        stdout: this.request.stdOut ? "piped" : "null",
        stderr: this.request.stdErr ? "piped" : "null",
      });

      const process = command.spawn();
      this.process = process;

      // Both pumps run without awaiting: stderr would otherwise not be read
      // until stdout closed, and a child that fills its stderr pipe while
      // writing to stdout would deadlock.
      if (this.request.stdOut && process.stdout) {
        this.pump(process.stdout, "stdout");
      }
      if (this.request.stdErr && process.stderr) {
        this.pump(process.stderr, "stderr");
      }

      return process;
    } catch (error) {
      console.error(`failed to start ${bin}:`, error);
      return undefined;
    }
  }

  /**
   * Reads a child stream line by line and publishes each one.
   *
   * Events carry the process key, so a subscriber can ask for one daemon's
   * output rather than filtering everything. The websocket controller
   * subscribes to `daemon.<key>`.
   */
  private async pump(stream: ReadableStream<Uint8Array>, channel: "stdout" | "stderr") {
    const lines = stream
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());

    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      this.emitter.emit(`daemon.${this.request.key}`, line);
      this.emitter.emit(`daemon.${this.request.key}.${channel}`, line);
    }
  }
}
