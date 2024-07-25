import { FlintClassLoader } from "./class_loader/flint_class_loader";

export class FlintValueInfo {
    public readonly name: string;
    public readonly type: string;
    public readonly value: number | bigint | string;
    public readonly size: number;
    public readonly reference: number;

    public constructor(name: string, type: string, value: number | bigint | string, size: number, reference: number) {
        this.name = name;
        this.type = type;
        this.value = value;
        this.size = size;
        this.reference = reference;
    }
}
