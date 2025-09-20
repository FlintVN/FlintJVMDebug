
import { FlintDbgCmd } from './flint_debug_enum_types';
import { FlintDbgRespCode } from './flint_debug_enum_types';

export class FlintDataResponse {
    public readonly cmd: FlintDbgCmd;
    private offset: number;
    private readonly data: Buffer;
    public readonly responseCode: FlintDbgRespCode;

    public constructor(cmd: FlintDbgCmd, responseCode: FlintDbgRespCode, data: Buffer) {
        this.cmd = cmd;
        this.offset = 0;
        this.data = data;
        this.responseCode = responseCode;
    }

    public startRead() {
        this.offset = 0;
    }

    public getDataLength(): number {
        return this.data.length;
    }

    public readU8(): number {
        return this.data[this.offset++];
    }

    public readU16(): number {
        let ret = this.data[this.offset++];
        ret |= this.data[this.offset++] << 8;
        return ret;
    }

    public readU32(): number {
        let ret = this.data[this.offset++];
        ret |= this.data[this.offset++] << 8;
        ret |= this.data[this.offset++] << 16;
        ret |= this.data[this.offset++] << 24;
        return ret >>> 0;
    }

    public readU64(): bigint {
        let ret = BigInt(this.data[this.offset++]);
        ret |= BigInt(this.data[this.offset++]) << 8n;
        ret |= BigInt(this.data[this.offset++]) << 16n;
        ret |= BigInt(this.data[this.offset++]) << 24n;
        ret |= BigInt(this.data[this.offset++]) << 32n;
        ret |= BigInt(this.data[this.offset++]) << 40n;
        ret |= BigInt(this.data[this.offset++]) << 48n;
        ret |= BigInt(this.data[this.offset++]) << 56n;
        return ret;
    }

    public readString(): string {
        if((this.data.length - this.offset) > 2) {
            const len = this.readU16();
            const str = this.data.toString('utf-8', this.offset, this.offset + len);
            this.offset += len + 1;
            return str;
        }
        return '';
    }

    public readAllAsString(): string | null {
        if(this.data.length === 0)
            return null;
        return this.data.toString('utf-8');
    }
}
