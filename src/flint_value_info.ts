import { FlintClassLoader } from "./class_loader/flint_class_loader";

export class FlintVariableValue {
    public readonly name: string;
    public readonly type: string;
    public readonly value?: number | bigint;
    public readonly size: number;

    public constructor(name: string, type: string, value: number | bigint | undefined, size: number) {
        this.name = name;
        this.type = type;
        this.value = value;
        this.size = size;
    }
}
