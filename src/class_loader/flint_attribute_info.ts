
export class FlintAttribute {
    public static readonly ATTRIBUTE_CONSTANT_VALUE = 0;
    public static readonly ATTRIBUTE_CODE = 1;
    public static readonly ATTRIBUTE_STACK_MAP_TABLE = 2;
    public static readonly ATTRIBUTE_EXCEPTIONS = 3;
    public static readonly ATTRIBUTE_INNER_CLASSES = 4;
    public static readonly ATTRIBUTE_ENCLOSING_METHOD = 5;
    public static readonly ATTRIBUTE_SYNTHETIC = 6;
    public static readonly ATTRIBUTE_SIGNATURE = 7;
    public static readonly ATTRIBUTE_SOURCE_FILE = 8;
    public static readonly ATTRIBUTE_SOURCE_DEBUG_EXTENSION = 9;
    public static readonly ATTRIBUTE_LINE_NUMBER_TABLE = 10;
    public static readonly ATTRIBUTE_LOCAL_VARIABLE_TABLE = 11;
    public static readonly ATTRIBUTE_LOCAL_VARIABLE_TYPE_TABLE = 12;
    public static readonly ATTRIBUTE_DEPRECATED = 13;
    public static readonly ATTRIBUTE_RUNTIME_VISIBLE_ANNOTATIONS = 14;
    public static readonly ATTRIBUTE_RUNTIME_INVISIBLE_ANNOTATIONS = 15;
    public static readonly ATTRIBUTE_RUNTIME_VISIBLE_PARAMETER_ANNOTATIONS = 16;
    public static readonly ATTRIBUTE_RUNTIME_INVISIBLE_PARAMETER_ANNOTATIONS = 17;
    public static readonly ATTRIBUTE_ANNOTATION_DEFAULT = 18;
    public static readonly ATTRIBUTE_BOOTSTRAP_METHODS = 19;
    public static readonly ATTRIBUTE_NEST_MEMBERS = 20;
    public static readonly ATTRIBUTE_NATIVE = 21;
    public static readonly ATTRIBUTE_UNKNOW = 0xFF;

    public tag: number;

    protected constructor(tag: number) {
        this.tag = tag;
    }

    public static parseAttributeType(name: string): number {
        if(name === 'Code')
            return FlintAttribute.ATTRIBUTE_CODE;
        else if(name === 'LineNumberTable')
                return FlintAttribute.ATTRIBUTE_LINE_NUMBER_TABLE;
        else if(name === 'LocalVariableTable')
            return FlintAttribute.ATTRIBUTE_LOCAL_VARIABLE_TABLE;
        else if(name === 'ConstantValue')
            return FlintAttribute.ATTRIBUTE_CONSTANT_VALUE;
        else if(name == 'SourceFile')
            return FlintAttribute.ATTRIBUTE_SOURCE_FILE;
        return FlintAttribute.ATTRIBUTE_UNKNOW;
    }
}

export class FlintLineNumber {
    public readonly startPc: number;
    public readonly line: number;

    public constructor(startPc: number, line: number) {
        this.startPc = startPc;
        this.line = line;
    }
}

export class FlintLineNumberAttribute extends FlintAttribute {
    public linesNumber: FlintLineNumber[];

    public constructor(linesNumber: FlintLineNumber[]) {
        super(FlintAttribute.ATTRIBUTE_LINE_NUMBER_TABLE);
        this.linesNumber = linesNumber;
    }
}

export class FlintLocalVariable {
    public readonly startPc: number;
    public readonly length: number;
    public readonly index: number;
    public readonly name: string;
    public readonly descriptor: string;

    public constructor(startPc: number, length: number, index: number, name: string, descriptor: string) {
        this.startPc = startPc;
        this.length = length;
        this.index = index;
        this.name = name;
        this.descriptor = descriptor;
    }
};

export class FlintLocalVariableAttribute extends FlintAttribute {
    public localVariables: FlintLocalVariable[];

    public constructor(localVariables: FlintLocalVariable[]) {
        super(FlintAttribute.ATTRIBUTE_LOCAL_VARIABLE_TABLE);
        this.localVariables = localVariables;
    }
}

export class FlintCodeAttribute extends FlintAttribute {
    public readonly maxStack: number;
    public readonly maxLocals: number;
    public readonly code: Buffer;
    public attributes: FlintAttribute[] | undefined;

    public constructor(maxStack: number, maxLocals: number, code: Buffer, attributes: FlintAttribute[] | undefined) {
        super(FlintAttribute.ATTRIBUTE_CODE);
        this.maxStack = maxStack;
        this.maxLocals = maxLocals;
        this.code = code;
        this.attributes = attributes;
    }

    public getLinesNumber(): FlintLineNumberAttribute | undefined {
        if(this.attributes) {
            for(let i = 0; i < this.attributes.length; i++) {
                if(this.attributes[i].tag === FlintAttribute.ATTRIBUTE_LINE_NUMBER_TABLE)
                    return this.attributes[i] as FlintLineNumberAttribute;
            };
        }
        return undefined;
    }

    public getLocalVariables(): FlintLocalVariableAttribute | undefined {
        if(this.attributes) {
            for(let i = 0; i < this.attributes.length; i++) {
                if(this.attributes[i].tag === FlintAttribute.ATTRIBUTE_LOCAL_VARIABLE_TABLE)
                    return this.attributes[i] as FlintLocalVariableAttribute;
            };
        }
        return undefined;
    }
}

export class FlintConstAttribute extends FlintAttribute {
    public readonly value: number | bigint | string;

    public constructor(value: number | bigint | string) {
        super(FlintAttribute.ATTRIBUTE_CONSTANT_VALUE);
        this.value = value;
    }
}

export class FlintSourceAttribute extends FlintAttribute {
    public readonly sourceFile: string;

    public constructor(sourceFile: string) {
        super(FlintAttribute.ATTRIBUTE_SOURCE_FILE);
        this.sourceFile = sourceFile;
    }
}
