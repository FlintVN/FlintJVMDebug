
export class FlintConstClass {
    public readonly constUtf8Index: number;

    public constructor(constUtf8Index: number) {
        this.constUtf8Index = constUtf8Index;
    }
}

export class FlintConstSting {
    public readonly constUtf8Index: number;

    public constructor(constUtf8Index: number) {
        this.constUtf8Index = constUtf8Index;
    }
}

export class FlintConstMethodType {
    public readonly descriptorIndex: number;

    public constructor(descriptorIndex: number) {
        this.descriptorIndex = descriptorIndex;
    }
}

export class FlintConstField {
    public readonly classIndex: number;
    public readonly nameAndTypeIndex: number;

    public constructor(classIndex: number, nameAndTypeIndex: number) {
        this.classIndex = classIndex;
        this.nameAndTypeIndex = nameAndTypeIndex;
    }
}

export class FlintConstMethod {
    public readonly classIndex: number;
    public readonly nameAndTypeIndex: number;

    public constructor(classIndex: number, nameAndTypeIndex: number) {
        this.classIndex = classIndex;
        this.nameAndTypeIndex = nameAndTypeIndex;
    }
}

export class FlintConstInterfaceMethod {
    public readonly classIndex: number;
    public readonly nameAndTypeIndex: number;

    public constructor(classIndex: number, nameAndTypeIndex: number) {
        this.classIndex = classIndex;
        this.nameAndTypeIndex = nameAndTypeIndex;
    }
}

export class FlintConstNameAndType {
    public readonly nameIndex: number;
    public readonly descriptorIndex: number;

    public constructor(nameIndex: number, descriptorIndex: number) {
        this.nameIndex = nameIndex;
        this.descriptorIndex = descriptorIndex;
    }
}

export class FlintConstInvokeDynamic {
    public readonly bootstrapMethodAttrIndex: number;
    public readonly nameAndTypeIndex: number;

    public constructor(bootstrapMethodAttrIndex: number, nameAndTypeIndex: number) {
        this.bootstrapMethodAttrIndex = bootstrapMethodAttrIndex;
        this.nameAndTypeIndex = nameAndTypeIndex;
    }
}

export class FlintConstMethodHandle {
    public readonly referenceKind: number;
    public readonly referenceIndex: number;

    public constructor(referenceKind: number, referenceIndex: number) {
        this.referenceKind = referenceKind;
        this.referenceIndex = referenceIndex;
    }
}
