
import * as net from 'net';
import { FlintClient } from "./flint_client";

export class FlintTcpClient extends FlintClient {
    private readonly port: number;
    private readonly address: string;
    private socket: net.Socket;

    public constructor(port: number, address: string) {
        super();
        this.port = port;
        this.address = address;
        this.socket = new net.Socket();
    }

    public async connect(): Promise<boolean> {
        await this.socket.connect(this.port, this.address);
        return true;
    }

    public disconnect() {
        this.socket.end();
    }

    public isConnected(): boolean {
        return !this.socket.destroyed && !this.socket.connecting;
    }

    public async write(buffer: Uint8Array): Promise<boolean> {
        return this.socket.write(buffer);
    }

    public on(event: string, listener: (data: any) => void): this {
        this.socket.on(event, listener);
        return this;
    }

    public removeAllListeners(): this {
        this.socket.removeAllListeners();
        return this;
    }

    public toString(): string {
        return this.address + ':' + this.port;
    }
}
