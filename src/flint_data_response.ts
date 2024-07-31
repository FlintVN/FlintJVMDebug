
import { FlintDbgCmd } from './flint_debug_enum_types';
import { FlintDbgRespCode } from './flint_debug_enum_types';

export class FlintDataResponse {
    public cmd: FlintDbgCmd;
    public data: Buffer;
    public responseCode: FlintDbgRespCode;

    public constructor(cmd: FlintDbgCmd, responseCode: FlintDbgRespCode, data: Buffer) {
        this.cmd = cmd;
        this.data = data;
        this.responseCode = responseCode;
    }
}
