import {
    OnEvent
} from "@danet/core";

export class ProcessListener {

    @OnEvent('process.stdout')
    onStdOut(data: string) {
        console.log(data);
    }

    @OnEvent('process.stderr')
    onStdErr(data: string) {
        console.log(data);
    }
}