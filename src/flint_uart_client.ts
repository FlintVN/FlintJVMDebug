
import { SerialPort } from 'serialport';
import { FlintClient } from "./flint_client";

export class FlintUartClient extends FlintClient {
    private readonly serialPort: SerialPort;

    public constructor(port: string) {
        super();
        this.serialPort = new SerialPort({
            path: port,
            baudRate: 921600,
            autoOpen: false,
        });
    }

    public async connect(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            this.serialPort.open((err) => {
                if(err)
                    resolve(false);
                else
                    resolve(true);
            });
        });
    }

    public disconnect() {
        this.serialPort.close();
    }

    public isConnected(): boolean {
        return this.serialPort.isOpen;
    }

    public async write(buffer: Uint8Array): Promise<boolean> {
        return this.serialPort.write(buffer);
    }

    public on(event: string, listener: (data: any) => void): this {
        this.serialPort.on(event, listener);
        return this;
    }

    public removeAllListeners(): this {
        this.serialPort.removeAllListeners();
        return this;
    }

    public toString(): string {
        return this.serialPort.path;
    }
}
