
export abstract class FlintClient {
    public abstract connect(): Promise<boolean>;
    public abstract disconnect(): void;
    public abstract write(buffer: Uint8Array): Promise<boolean>;
    public abstract isConnect(): boolean;
    public abstract on(event: 'data', listener: (data: Buffer) => void): this;
    public abstract on(event: 'error', listener: (err: Error) => void): this;
    public abstract on(event: 'close', listener: (hadError: boolean) => void): this;
    public abstract removeAllListeners(): this;
}
