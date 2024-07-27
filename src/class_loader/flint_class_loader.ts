
import fs = require('fs');
import path = require('path');
import * as vscode from 'vscode';
import {
    FlintConstClass,
    FlintConstSting,
    FlintConstMethodType,
    FlintConstField,
    FlintConstMethod,
    FlintConstInterfaceMethod,
    FlintConstNameAndType,
    FlintConstInvokeDynamic,
    FlintConstMethodHandle
} from './flint_const_pool';
import {
    FlintAttribute,
    FlintCodeAttribute,
    FlintLineNumber,
    FlintLineNumberAttribute,
    FlintLocalVariable,
    FlintLocalVariableAttribute,
    FlintConstAttribute
} from './flint_attribute_info';
import { FlintMethodInfo } from './flint_method_info';
import { FlintFieldInfo } from './flint_field_info';

export class FlintClassLoader {
    public readonly magic: number;
    public readonly minorVersion: number;
    public readonly majorVersion: number;
    public readonly accessFlags: number;
    public readonly thisClass: string;
    public readonly superClass?: string;
    public readonly interfacesCount: number;
    public readonly classPath: string;
    public readonly sourcePath?: string;

    private fieldInfos?: FlintFieldInfo[];
    public methodsInfos: FlintMethodInfo[];

    private readonly poolTable: (
        number |
        bigint |
        string |
        FlintConstClass |
        FlintConstSting |
        FlintConstMethodType |
        FlintConstField |
        FlintConstMethod |
        FlintConstInterfaceMethod |
        FlintConstNameAndType |
        FlintConstInvokeDynamic |
        FlintConstMethodHandle
    )[] = [];

    public static sdkClassPath?: string;
    public static sdkSourcePath?: string;

    private static readonly CONST_UTF8 = 1;
    private static readonly CONST_INTEGER = 3;
    private static readonly CONST_FLOAT = 4;
    private static readonly CONST_LONG = 5;
    private static readonly CONST_DOUBLE = 6;
    private static readonly CONST_CLASS = 7;
    private static readonly CONST_STRING = 8;
    private static readonly CONST_FIELD = 9;
    private static readonly CONST_METHOD = 10;
    private static readonly CONST_INTERFACE_METHOD = 11;
    private static readonly CONST_NAME_AND_TYPE = 12;
    private static readonly CONST_METHOD_HANDLE = 15;
    private static readonly CONST_METHOD_TYPE = 16;
    private static readonly CONST_INVOKE_DYNAMIC = 18;

    public static readonly CLASS_PUBLIC = 0x0001;
    public static readonly CLASS_FINAL = 0x0010;
    public static readonly CLASS_SUPER = 0x0020;
    public static readonly CLASS_INTERFACE = 0x0200;
    public static readonly CLASS_ABSTRACT = 0x0400;
    public static readonly CLASS_SYNTHETIC = 0x1000;
    public static readonly CLASS_ANNOTATION = 0x2000;

    private static classLoaderDictionary: Record<string, FlintClassLoader> = {};

    private static findSourceFile(name: string): string | undefined {
        name += '.java';
        const workspace = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
        let fullPath = path.join(workspace, name);
        if(fs.existsSync(fullPath))
            return fullPath;
        else if(FlintClassLoader.sdkSourcePath) {
            fullPath = path.join(FlintClassLoader.sdkSourcePath, name);
            if(fs.existsSync(fullPath))
                return fullPath;
        }
        return undefined;
    }

    private static findClassFile(name: string): string | undefined {
        name += '.class';
        const workspace = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
        let fullPath = path.join(workspace, name);
        if(fs.existsSync(fullPath))
            return fullPath;
        else if(FlintClassLoader.sdkClassPath) {
            fullPath = path.join(FlintClassLoader.sdkClassPath, name);
            if(fs.existsSync(fullPath))
                return fullPath;
        }
        return undefined;
    }

    public static load(className: string): FlintClassLoader {
        className = className.replace(/\\/g, '\/');
        if(!(className in FlintClassLoader.classLoaderDictionary)) {
            const classPath = FlintClassLoader.findClassFile(className);
            if(classPath)
                FlintClassLoader.classLoaderDictionary[className] = new FlintClassLoader(classPath);
            else
                throw 'Could not find ' + '\"' + className + '\"' + 'class file';
        }
        return FlintClassLoader.classLoaderDictionary[className];
    }

    private constructor(filePath: string) {
        this.classPath = filePath;
        const data = fs.readFileSync(filePath, undefined);

        let index = 0;
        this.magic = this.readU32(data, index);
        index += 4;
        this.minorVersion = this.readU16(data, index);
        index += 2;
        this.majorVersion = this.readU16(data, index);
        index += 2;
        const poolCount = this.readU16(data, index) - 1;
        index += 2;

        for(let i = 0; i < poolCount; i++) {
            const tag = data[index];
            index++;
            switch(tag) {
                case FlintClassLoader.CONST_UTF8: {
                    const length = this.readU16(data, index);
                    index += 2;
                    this.poolTable.push(data.toString('utf-8', index, index + length));
                    index += length;
                    break;
                }
                case FlintClassLoader.CONST_INTEGER:
                case FlintClassLoader.CONST_FLOAT:
                    this.poolTable.push(this.readU32(data, index));
                    index += 4;
                    break;
                case FlintClassLoader.CONST_FIELD:
                case FlintClassLoader.CONST_METHOD:
                case FlintClassLoader.CONST_INTERFACE_METHOD:
                case FlintClassLoader.CONST_NAME_AND_TYPE:
                case FlintClassLoader.CONST_INVOKE_DYNAMIC:
                    const index1 = this.readU16(data, index);
                    index += 2;
                    const index2 = this.readU16(data, index);
                    index += 2;
                    if(tag === FlintClassLoader.CONST_FIELD)
                        this.poolTable.push(new FlintConstField(index1, index2));
                    else if(tag === FlintClassLoader.CONST_METHOD)
                        this.poolTable.push(new FlintConstMethod(index1, index2));
                    else if(tag === FlintClassLoader.CONST_INTERFACE_METHOD)
                        this.poolTable.push(new FlintConstInterfaceMethod(index1, index2));
                    else if(tag === FlintClassLoader.CONST_NAME_AND_TYPE)
                        this.poolTable.push(new FlintConstNameAndType(index1, index2));
                    else if(tag === FlintClassLoader.CONST_INVOKE_DYNAMIC)
                        this.poolTable.push(new FlintConstInvokeDynamic(index1, index2));
                    break;
                case FlintClassLoader.CONST_LONG:
                case FlintClassLoader.CONST_DOUBLE: {
                    this.poolTable.push(this.readU64(data, index));
                    index += 8;
                    i++;
                    this.poolTable.push(0);
                    break;
                }
                case FlintClassLoader.CONST_CLASS:
                case FlintClassLoader.CONST_STRING:
                case FlintClassLoader.CONST_METHOD_TYPE: {
                    const constUtf8Index = this.readU16(data, index);
                    index += 2;
                    if(tag === FlintClassLoader.CONST_CLASS)
                        this.poolTable.push(new FlintConstClass(constUtf8Index));
                    else if(tag === FlintClassLoader.CONST_STRING)
                        this.poolTable.push(new FlintConstSting(constUtf8Index));
                    else if(tag === FlintClassLoader.CONST_METHOD_TYPE)
                        this.poolTable.push(new FlintConstMethodType(constUtf8Index));
                    break;
                }
                case FlintClassLoader.CONST_METHOD_HANDLE: {
                    const index1 = data[index];
                    index++;
                    const index2 = this.readU16(data, index);
                    index += 2;
                    this.poolTable.push(new FlintConstMethodHandle(index1, index2));
                    break;
                }
                default:
                    throw "uknow pool type";
            }
        }

        this.accessFlags = this.readU16(data, index);
        index += 2;
        const thisClass = this.poolTable[this.readU16(data, index) - 1] as FlintConstClass;
        this.thisClass = this.poolTable[thisClass.constUtf8Index - 1] as string;
        this.sourcePath = FlintClassLoader.findSourceFile(this.thisClass);
        index += 2;
        const superClassIndex = this.readU16(data, index);
        index += 2;
        if(superClassIndex) {
            const superClass = this.poolTable[superClassIndex - 1] as FlintConstClass;
            this.superClass = this.poolTable[superClass.constUtf8Index - 1] as string;
        }
        this.interfacesCount = this.readU16(data, index);
        index += 2;

        if(this.interfacesCount)
            index += this.interfacesCount * 2;

        const fieldsCount = this.readU16(data, index);
        index += 2;
        if(fieldsCount) {
            const fieldInfos: FlintFieldInfo[] = [];
            for(let i = 0; i < fieldsCount; i++) {
                const flag = this.readU16(data, index);
                index += 2;
                const fieldsNameIndex = this.readU16(data, index);
                index += 2;
                const fieldsDescriptorIndex = this.readU16(data, index);
                index += 2;
                let fieldsAttributesCount = this.readU16(data, index);
                index += 2;
                let constValue: number | bigint | string | undefined = undefined;
                while(fieldsAttributesCount--) {
                    const tmp = this.readAttribute(data, index);
                    if(tmp[1] && tmp[1].tag === FlintAttribute.ATTRIBUTE_CONSTANT_VALUE)
                        constValue = (tmp[1] as FlintConstAttribute).value;
                    index = tmp[0];
                }
                const fieldName: string = this.poolTable[fieldsNameIndex - 1] as string;
                const fieldDescriptor: string = this.poolTable[fieldsDescriptorIndex - 1] as string;
                fieldInfos.push(new FlintFieldInfo(fieldName, fieldDescriptor, flag, constValue));
            }
            this.fieldInfos = fieldInfos;
        }
        const methodsCount = this.readU16(data, index);
        index += 2;
        const methodsInfos: FlintMethodInfo[] = [];
        if(methodsCount) {
            for(let i = 0; i < methodsCount; i++) {
                const flag = this.readU16(data, index);
                index += 2;
                const methodNameIndex = this.readU16(data, index);
                index += 2;
                const methodDescriptorIndex = this.readU16(data, index);
                index += 2;
                let methodAttributesCount = this.readU16(data, index);
                index += 2;
                let attributeCode: FlintCodeAttribute | undefined = undefined;
                while(methodAttributesCount--) {
                    const tmp = this.readAttribute(data, index);
                    index = tmp[0];
                    if(tmp[1] && !attributeCode) {
                        if(tmp[1].tag === FlintAttribute.ATTRIBUTE_CODE)
                            attributeCode = tmp[1] as FlintCodeAttribute;
                    }
                }
                const methodName: string = this.poolTable[methodNameIndex - 1] as string;
                const methodDescriptor: string = this.poolTable[methodDescriptorIndex - 1] as string;
                if(!(flag & (FlintMethodInfo.METHOD_NATIVE | FlintMethodInfo.METHOD_BRIDGE)))
                    methodsInfos.push(new FlintMethodInfo(methodName, methodDescriptor, flag, attributeCode));
            }
        }
        this.methodsInfos = methodsInfos;
    }

    private readAttribute(data: Buffer, index: number): [number, FlintAttribute | undefined] {
        const nameIndex = this.readU16(data, index);
        index += 2;
        const length = this.readU32(data, index);
        index += 4;
        const type = FlintAttribute.parseAttributeType(this.poolTable[nameIndex - 1] as string);
        switch(type) {
            case FlintAttribute.ATTRIBUTE_CODE:
                return this.readAttributeCode(data, index);
            case FlintAttribute.ATTRIBUTE_LINE_NUMBER_TABLE:
                return this.readAttributeLineNumberTable(data, index);
            case FlintAttribute.ATTRIBUTE_LOCAL_VARIABLE_TABLE:
                return this.readAttributeLocalVariableTable(data, index);
            case FlintAttribute.ATTRIBUTE_CONSTANT_VALUE:
                return this.readAttributeConstValue(data, index);
            default:
                index += length;
                return [index, undefined];
        }
    }

    private readAttributeCode(data: Buffer, index: number): [number, FlintCodeAttribute] {
        const maxStack: number = this.readU16(data, index);
        index += 2;
        const maxLocals: number = this.readU16(data, index);
        index += 2;
        const codeLength: number = this.readU32(data, index);
        index += 4;
        const code = Buffer.alloc(codeLength)
        data.copy(code, 0, index, index + codeLength);
        index += codeLength;
        const exceptionTableLength = this.readU16(data, index);
        index += 2;
        index += exceptionTableLength * 8;
        let attrbutesCount = this.readU16(data, index);
        index += 2;
        if(attrbutesCount) {
            const attr: FlintAttribute[] = [];
            while(attrbutesCount--) {
                const tmp = this.readAttribute(data, index);
                index = tmp[0];
                if(tmp[1])
                    attr.push(tmp[1]);
            }
            return [index, new FlintCodeAttribute(maxStack, maxLocals, code, attr)];
        }
        return [index, new FlintCodeAttribute(maxStack, maxLocals, code, undefined)];
    }

    private readAttributeLineNumberTable(data: Buffer, index: number): [number, FlintLineNumberAttribute] {
        const lineNumberTableLength = this.readU16(data, index);
        index += 2;
        const linesNumber: FlintLineNumber[] = [];
        for(let i = 0; i < lineNumberTableLength; i++) {
            const startPc = this.readU16(data, index);
            index += 2;
            const lineNumber = this.readU16(data, index);
            index += 2;
            linesNumber.push(new FlintLineNumber(startPc, lineNumber));
        }
        return [index, new FlintLineNumberAttribute(linesNumber)];
    }

    private readAttributeLocalVariableTable(data: Buffer, index: number): [number, FlintLocalVariableAttribute] {
        const localVariableTableLength = this.readU16(data, index);
        index += 2;
        const localVariables: FlintLocalVariable[] = [];
        for(let i = 0; i < localVariableTableLength; i++) {
            const startPc = this.readU16(data, index);
            index += 2;
            const length = this.readU16(data, index);
            index += 2;
            const nameIndex = this.readU16(data, index);
            index += 2;
            const descriptorIndex = this.readU16(data, index);
            index += 2;
            const variableIndex = this.readU16(data, index);
            index += 2;
            const name = this.poolTable[nameIndex - 1] as string;
            const descriptor = this.poolTable[descriptorIndex - 1] as string;
            localVariables.push(new FlintLocalVariable(startPc, length, variableIndex, name, descriptor));
        }
        return [index, new FlintLocalVariableAttribute(localVariables)];
    }

    private readAttributeConstValue(data: Buffer, index: number): [number, FlintConstAttribute] {
        const constantValueIndex = this.readU16(data, index);
        const value = this.poolTable[constantValueIndex - 1];
        return [index + 2, new FlintConstAttribute(value as number | bigint | string)];
    }

    public getFieldList(includeParent: boolean): FlintFieldInfo[] | undefined {
        if(includeParent) {
            const ret: FlintFieldInfo[] = [];
            if(this.superClass) {
                const parentFields = FlintClassLoader.load(this.superClass).getFieldList(true);
                if(parentFields) {
                    for(let i = 0; i < parentFields.length; i++)
                        ret.push(parentFields[i]);
                }
            }
            if(this.fieldInfos) {
                for(let i = 0; i < this.fieldInfos.length; i++)
                    ret.push(this.fieldInfos[i]);
            }
            if(ret.length > 0)
                return ret;
            return undefined;
        }
        else
            return this.fieldInfos;
    }

    public getFieldInfo(name: string, descriptor?: string): FlintFieldInfo | undefined {
        if(!this.fieldInfos)
            return undefined;
        if(descriptor) {
            for(let i = 0; i < this.fieldInfos.length; i++) {
                if(this.fieldInfos[i].name === name && this.fieldInfos[i].descriptor === descriptor)
                    return this.fieldInfos[i];
            }
        }
        else for(let i = 0; i < this.fieldInfos.length; i++) {
            if(this.fieldInfos[i].name === name)
                return this.fieldInfos[i];
        }
        return undefined;
    }

    public getMethodInfo(name: string, descriptor: string): FlintMethodInfo | undefined {
        if(!this.methodsInfos)
            return undefined;
        for(let i = 0; i < this.methodsInfos.length; i++) {
            if(this.methodsInfos[i].name === name && this.methodsInfos[i].descriptor === descriptor)
                return this.methodsInfos[i];
        }
        return undefined;
    }

    public isClassOf(parentClassName: string): boolean {
        let thisClass: string | undefined = this.thisClass;
        let superClass = this.superClass;
        while(true) {
            if(thisClass === parentClassName)
                return true;
            else if(!superClass)
                return false;
            const classLoader = FlintClassLoader.load(superClass);
            thisClass = classLoader.thisClass;
            superClass = classLoader.superClass;
        }
    }

    private readU16(data: Buffer, offset : number): number {
        let ret = data[offset + 1];
        ret |= data[offset] << 8;
        return ret;
    }

    private readU32(data: Buffer, offset : number): number {
        let ret = data[offset + 3];
        ret |= data[offset + 2] << 8;
        ret |= data[offset + 1] << 16;
        ret |= data[offset] << 24;
        return ret;
    }

    private readU64(data: Buffer, offset : number): bigint {
        let ret = BigInt(data[offset + 7]);
        ret |= BigInt(data[offset + 6]) << 8n;
        ret |= BigInt(data[offset + 5]) << 16n;
        ret |= BigInt(data[offset + 4]) << 24n;
        ret |= BigInt(data[offset + 3]) << 32n;
        ret |= BigInt(data[offset + 2]) << 40n;
        ret |= BigInt(data[offset + 1]) << 48n;
        ret |= BigInt(data[offset]) << 56n;
        return ret;
    }
}
