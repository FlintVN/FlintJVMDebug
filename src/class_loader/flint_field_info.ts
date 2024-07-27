
export class FlintFieldInfo {
    public readonly accessFlag: number;
    public readonly name: string;
    public readonly descriptor: string;
    public readonly constValue?: number | bigint | string;

    public static readonly FIELD_PUBLIC = 0x0001;
    public static readonly FIELD_PRIVATE = 0x0002;
    public static readonly FIELD_PROTECTED = 0x0004;
    public static readonly FIELD_STATIC = 0x0008;
    public static readonly FIELD_FINAL = 0x0010;
    public static readonly FIELD_VOLATILE = 0x0040;
    public static readonly FIELD_TRANSIENT = 0x0080;
    public static readonly FIELD_SYNTHETIC = 0x1000;
    public static readonly FIELD_ENUM = 0x4000;
    public static readonly FIELD_UNLOAD = 0x8000;

    public constructor(name: string, descriptor: string, accessFlag: number, constValue?: number | bigint | string) {
        this.name = name;
        this.descriptor = descriptor;
        this.accessFlag = accessFlag;
        this.constValue = constValue;
    }
}
