
export class FlintMutex {
    private locked = false;
    private queue: (() => void)[] = [];

    public async lock(task: () => Promise<any>): Promise<any> {
        await this.acquireLock();
        try {
            return await task();
        }
        finally {
            this.releaseLock();
        }
    }

    private acquireLock(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!this.locked) {
                this.locked = true;
                resolve();
            }
            else
                this.queue.push(resolve);
        });
    }

    private releaseLock(): void {
        if(this.queue.length > 0) {
            const next = this.queue.shift();
            if(next)
                next();
        }
        else
            this.locked = false;
    }
}
