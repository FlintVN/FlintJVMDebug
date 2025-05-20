
import fs = require('fs');
import path = require('path');
import * as AdmZip from "adm-zip";
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
    FlintConstAttribute,
    FlintSourceAttribute,
    FlintInnerClassesAttribute
} from './flint_attribute_info';
import { FlintMethodInfo } from './flint_method_info';
import { FlintFieldInfo } from './flint_field_info';
import { FlintLineInfo } from './flint_line_info';
import { getWorkspace } from './../flint_common'

export class FlintClassLoader {
    private source?: string | null;
    private sourcePath?: string | null;
    public readonly magic: number;
    public readonly minorVersion: number;
    public readonly majorVersion: number;
    public readonly accessFlags: number;
    public readonly thisClass: string;
    public readonly superClass?: string;
    public readonly interfacesCount: number;
    public readonly sourceFile: string;
    public readonly innerClasses?: string[];

    private fieldInfos?: FlintFieldInfo[];
    public methodsInfos: FlintMethodInfo[];

    private lineInfoSorted?: FlintLineInfo[];

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

    private static cwd?: string;
    private static classPath?: string[];
    private static sourcePath?: string[];
    private static modulePath?: string[];

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

    private static classLoaderDictionary = new Map<string, FlintClassLoader>();

    public static setCwd(cwd?: string) {
        const workspace = getWorkspace();
        let tmp = cwd ? path.resolve(workspace, cwd) : workspace;
        tmp = tmp.trim();
        tmp = fs.realpathSync.native(tmp);
        tmp = tmp.replace(/\\/g, '\/');
        FlintClassLoader.cwd = tmp;
    }

    public static getCwd(): string | undefined {
        return FlintClassLoader.cwd;
    }

    public static setClassPath(classPath?: string[]) {
        if(classPath && classPath.length > 0) {
            FlintClassLoader.classPath = [];
            const workspace = getWorkspace();
            for(let i = 0; i < classPath.length; i++) {
                const moduleClsPath = classPath[i];
                let tmp = path.resolve(workspace, moduleClsPath).trim();
                tmp = fs.realpathSync.native(tmp);
                tmp = tmp.replace(/\\/g, '\/');
                FlintClassLoader.classPath.push(tmp);
            }
        }
        else
            FlintClassLoader.classPath = undefined;
    }

    public static setModulePath(modulePath?: string[]) {
        this.modulePath = modulePath;
    }

    public static setSourcePath(sourcePath?: string[]) {
        if(sourcePath && sourcePath.length > 0) {
            FlintClassLoader.sourcePath = [];
            const workspace = getWorkspace();
            for(let i = 0; i < sourcePath.length; i++) {
                let moduleSrcPath = sourcePath[i];
                let tmp = path.resolve(workspace, moduleSrcPath).trim();
                tmp = fs.realpathSync.native(tmp);
                tmp = tmp.replace(/\\/g, '\/');
                FlintClassLoader.sourcePath.push(tmp);
            }
        }
        else
            FlintClassLoader.sourcePath = undefined;
    }

    private static findSourceFile(name: string): string | null {
        if(FlintClassLoader.sourcePath) {
            for(let i = 0; i < FlintClassLoader.sourcePath.length; i++) {
                const fullPath = path.join(FlintClassLoader.sourcePath[i], name);
                if(fs.existsSync(fullPath))
                    return fullPath.replace(/\\/g, '\/');
            }
        }
        return null;
    }

    private static findClassFile(name: string): string | undefined {
        if(FlintClassLoader.cwd) {
            const fullPath = path.join(FlintClassLoader.cwd, name);
            if(fs.existsSync(fullPath))
                return fullPath.replace(/\\/g, '\/');
        }
        if(FlintClassLoader.classPath) {
            for(let i = 0; i < FlintClassLoader.classPath.length; i++) {
                const fullPath = path.join(FlintClassLoader.classPath[i], name);
                if(fs.existsSync(fullPath))
                    return fullPath.replace(/\\/g, '\/');
            }
        }
        return undefined;
    }

    public static getClassNameFormSourceFileName(srcPath: string): string {
        const lastDotIndex = srcPath.lastIndexOf('.');
        if(lastDotIndex < 0)
            throw srcPath + ' is not java source file';
        if(srcPath.substring(lastDotIndex, srcPath.length).toLowerCase() !== '.java')
            throw srcPath + ' is not java source file';
        if(fs.existsSync(srcPath))
            srcPath = fs.realpathSync.native(srcPath);
        const fileName = srcPath.substring(0, lastDotIndex).replace(/\\/g, '\/');
        let className: string = fileName;
        if(FlintClassLoader.cwd && fileName.indexOf(FlintClassLoader.cwd) === 0)
            className = fileName.substring(FlintClassLoader.cwd.length);
        else if(FlintClassLoader.sourcePath) {
            for(let i = 0; i < FlintClassLoader.sourcePath.length; i++) {
                if(fileName.indexOf(FlintClassLoader.sourcePath[i]) === 0) {
                    className = fileName.substring(FlintClassLoader.sourcePath[i].length);
                    break;
                }
            }
        }
        while(className.charAt(0) === '\/')
            className = className.substring(1);
        return className;
    }

    private static findAndReadClassFormModules(classFileName: string): Buffer | undefined {
        if(!FlintClassLoader.modulePath)
            return undefined;
        const workspace = getWorkspace();
        for(let i = 0; i < FlintClassLoader.modulePath.length; i++) {
            const p = path.resolve(workspace, FlintClassLoader.modulePath[i]).trim();
            const zip = new AdmZip(p);
            const entry = zip.getEntry(classFileName);
            if(entry)
                return entry.getData();
        }
        return undefined;
    }

    private static findSourceFormModules(fileName: string): string | null {
        if(!FlintClassLoader.modulePath)
            return null;
        const workspace = getWorkspace();
        for(let i = 0; i < FlintClassLoader.modulePath.length; i++) {
            const p = path.resolve(workspace, FlintClassLoader.modulePath[i]).trim();
            const zip = new AdmZip(p);
            const entry = zip.getEntry('src/' + fileName);
            if(entry) {
                const content = entry.getData().toString("utf-8");
                return content;
            }
        }
        return null;
    }

    public static load(className: string): FlintClassLoader {
        className = className.replace(/\\/g, '\/');
        if(!FlintClassLoader.classLoaderDictionary.has(className)) {
            let clsData: Buffer | undefined;
            const classPath = FlintClassLoader.findClassFile(className + '.class');
            if(classPath)
                clsData = fs.readFileSync(classPath, undefined);
            else
                clsData = FlintClassLoader.findAndReadClassFormModules(className + '.class');
            if(!clsData)
                throw 'Could not load ' + '"' + className + '"';
            FlintClassLoader.classLoaderDictionary.set(className, new FlintClassLoader(clsData));
        }
        return FlintClassLoader.classLoaderDictionary.get(className) as FlintClassLoader;
    }

    public static freeAll() {
        FlintClassLoader.classLoaderDictionary.clear();
    }

    private constructor(data: Buffer) {
        let index = 0;
        this.magic = FlintClassLoader.readU32(data, index);
        index += 4;
        this.minorVersion = FlintClassLoader.readU16(data, index);
        index += 2;
        this.majorVersion = FlintClassLoader.readU16(data, index);
        index += 2;
        const poolCount = FlintClassLoader.readU16(data, index) - 1;
        index += 2;

        for(let i = 0; i < poolCount; i++) {
            const tag = data[index];
            index++;
            switch(tag) {
                case FlintClassLoader.CONST_UTF8: {
                    const length = FlintClassLoader.readU16(data, index);
                    index += 2;
                    this.poolTable.push(data.toString('utf-8', index, index + length));
                    index += length;
                    break;
                }
                case FlintClassLoader.CONST_INTEGER:
                case FlintClassLoader.CONST_FLOAT:
                    this.poolTable.push(FlintClassLoader.readU32(data, index));
                    index += 4;
                    break;
                case FlintClassLoader.CONST_FIELD:
                case FlintClassLoader.CONST_METHOD:
                case FlintClassLoader.CONST_INTERFACE_METHOD:
                case FlintClassLoader.CONST_NAME_AND_TYPE:
                case FlintClassLoader.CONST_INVOKE_DYNAMIC:
                    const index1 = FlintClassLoader.readU16(data, index);
                    index += 2;
                    const index2 = FlintClassLoader.readU16(data, index);
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
                    this.poolTable.push(FlintClassLoader.readU64(data, index));
                    index += 8;
                    i++;
                    this.poolTable.push(0);
                    break;
                }
                case FlintClassLoader.CONST_CLASS:
                case FlintClassLoader.CONST_STRING:
                case FlintClassLoader.CONST_METHOD_TYPE: {
                    const constUtf8Index = FlintClassLoader.readU16(data, index);
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
                    const index2 = FlintClassLoader.readU16(data, index);
                    index += 2;
                    this.poolTable.push(new FlintConstMethodHandle(index1, index2));
                    break;
                }
                default:
                    throw "uknow pool type";
            }
        }

        this.accessFlags = FlintClassLoader.readU16(data, index);
        index += 2;
        const thisClass = this.poolTable[FlintClassLoader.readU16(data, index) - 1] as FlintConstClass;
        this.thisClass = this.poolTable[thisClass.constUtf8Index - 1] as string;
        index += 2;
        const superClassIndex = FlintClassLoader.readU16(data, index);
        index += 2;
        if(superClassIndex) {
            const superClass = this.poolTable[superClassIndex - 1] as FlintConstClass;
            this.superClass = this.poolTable[superClass.constUtf8Index - 1] as string;
        }
        this.interfacesCount = FlintClassLoader.readU16(data, index);
        index += 2;

        if(this.interfacesCount)
            index += this.interfacesCount * 2;

        const fieldsCount = FlintClassLoader.readU16(data, index);
        index += 2;
        if(fieldsCount) {
            const fieldInfos: FlintFieldInfo[] = [];
            for(let i = 0; i < fieldsCount; i++) {
                const flag = FlintClassLoader.readU16(data, index);
                index += 2;
                const fieldsNameIndex = FlintClassLoader.readU16(data, index);
                index += 2;
                const fieldsDescriptorIndex = FlintClassLoader.readU16(data, index);
                index += 2;
                let fieldsAttributesCount = FlintClassLoader.readU16(data, index);
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
        const methodsCount = FlintClassLoader.readU16(data, index);
        index += 2;
        const methodsInfos: FlintMethodInfo[] = [];
        if(methodsCount) {
            for(let i = 0; i < methodsCount; i++) {
                const flag = FlintClassLoader.readU16(data, index);
                index += 2;
                const methodNameIndex = FlintClassLoader.readU16(data, index);
                index += 2;
                const methodDescriptorIndex = FlintClassLoader.readU16(data, index);
                index += 2;
                let methodAttributesCount = FlintClassLoader.readU16(data, index);
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
                if(!(flag & (FlintMethodInfo.METHOD_NATIVE)))
                    methodsInfos.push(new FlintMethodInfo(methodName, methodDescriptor, flag, attributeCode));
            }
        }
        this.methodsInfos = methodsInfos;
        let attributesCount = FlintClassLoader.readU16(data, index);
        let sourceFile: string | undefined;
        index += 2;
        while(attributesCount--) {
            const tmp = this.readAttribute(data, index);
            index = tmp[0];
            if(tmp[1]) {
                if(tmp[1].tag === FlintAttribute.ATTRIBUTE_SOURCE_FILE) {
                    const lastDot = this.thisClass.lastIndexOf('/');
                    const packageName = (lastDot > 0) ? this.thisClass.substring(0, lastDot) : '';
                    sourceFile = path.join(packageName, (tmp[1] as FlintSourceAttribute).sourceFile);
                }
                else if(tmp[1].tag === FlintAttribute.ATTRIBUTE_INNER_CLASSES)
                    this.innerClasses = (tmp[1] as FlintInnerClassesAttribute).classes;
            }
        }
        if(!sourceFile)
            throw 'No source file information available';
        this.sourceFile = sourceFile.replace(/\\/g, '\/');
    }

    private readAttribute(data: Buffer, index: number): [number, FlintAttribute | undefined] {
        const nameIndex = FlintClassLoader.readU16(data, index);
        index += 2;
        const length = FlintClassLoader.readU32(data, index);
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
            case FlintAttribute.ATTRIBUTE_SOURCE_FILE:
                return this.readAttributeSource(data, index);
            case FlintAttribute.ATTRIBUTE_INNER_CLASSES:
                return this.readAttributeInnerClasses(data, index);
            default:
                index += length;
                return [index, undefined];
        }
    }

    private readAttributeCode(data: Buffer, index: number): [number, FlintCodeAttribute] {
        const maxStack: number = FlintClassLoader.readU16(data, index);
        index += 2;
        const maxLocals: number = FlintClassLoader.readU16(data, index);
        index += 2;
        const codeLength: number = FlintClassLoader.readU32(data, index);
        index += 4;
        const code = Buffer.alloc(codeLength)
        data.copy(code, 0, index, index + codeLength);
        index += codeLength;
        const exceptionTableLength = FlintClassLoader.readU16(data, index);
        index += 2;
        index += exceptionTableLength * 8;
        let attrbutesCount = FlintClassLoader.readU16(data, index);
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
        const lineNumberTableLength = FlintClassLoader.readU16(data, index);
        index += 2;
        const linesNumber: FlintLineNumber[] = [];
        for(let i = 0; i < lineNumberTableLength; i++) {
            const startPc = FlintClassLoader.readU16(data, index);
            index += 2;
            const lineNumber = FlintClassLoader.readU16(data, index);
            index += 2;
            linesNumber.push(new FlintLineNumber(startPc, lineNumber));
        }
        return [index, new FlintLineNumberAttribute(linesNumber)];
    }

    private readAttributeLocalVariableTable(data: Buffer, index: number): [number, FlintLocalVariableAttribute] {
        const localVariableTableLength = FlintClassLoader.readU16(data, index);
        index += 2;
        const localVariables: FlintLocalVariable[] = [];
        for(let i = 0; i < localVariableTableLength; i++) {
            const startPc = FlintClassLoader.readU16(data, index);
            index += 2;
            const length = FlintClassLoader.readU16(data, index);
            index += 2;
            const nameIndex = FlintClassLoader.readU16(data, index);
            index += 2;
            const descriptorIndex = FlintClassLoader.readU16(data, index);
            index += 2;
            const variableIndex = FlintClassLoader.readU16(data, index);
            index += 2;
            const name = this.poolTable[nameIndex - 1] as string;
            const descriptor = this.poolTable[descriptorIndex - 1] as string;
            localVariables.push(new FlintLocalVariable(startPc, length, variableIndex, name, descriptor));
        }
        return [index, new FlintLocalVariableAttribute(localVariables)];
    }

    private readAttributeConstValue(data: Buffer, index: number): [number, FlintConstAttribute] {
        const constantValueIndex = FlintClassLoader.readU16(data, index);
        const value = this.poolTable[constantValueIndex - 1];
        return [index + 2, new FlintConstAttribute(value as number | bigint | string)];
    }

    private readAttributeSource(data: Buffer, index: number): [number, FlintSourceAttribute] {
        const sourceFileIndex = FlintClassLoader.readU16(data, index);
        const value = this.poolTable[sourceFileIndex - 1];
        return [index + 2, new FlintSourceAttribute(value as string)];
    }

    private readAttributeInnerClasses(data: Buffer, index: number): [number, FlintInnerClassesAttribute] {
        const numOfClasses = FlintClassLoader.readU16(data, index);
        index += 2;
        const innerClassesName: string[] = [];
        const lastDot = this.thisClass.lastIndexOf('/');
        for(let i = 0; i < numOfClasses; i++) {
            const innerClassInfoIndex = FlintClassLoader.readU16(data, index);
            index += 2;
            const outerClassInfoIndex = FlintClassLoader.readU16(data, index);
            index += 2;
            const innerNameIndex = FlintClassLoader.readU16(data, index);
            index += 2;
            const innerClassAccessFlags = FlintClassLoader.readU16(data, index);
            index += 2;

            const innerClassConstClass = this.poolTable[innerClassInfoIndex - 1] as FlintConstClass;
            const innerClassName = this.poolTable[innerClassConstClass.constUtf8Index - 1] as string;

            if(innerClassName.length > this.thisClass.length)
                innerClassesName.push(innerClassName);
        }
        return [index, new FlintInnerClassesAttribute(innerClassesName)];
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

    private createAndSortAllLineInfo(): FlintLineInfo[] {
        const ret: FlintLineInfo[] = [];

        for(let i = 0; i < this.methodsInfos.length; i++) {
            const methodInfo = this.methodsInfos[i];
            if(methodInfo.attributeCode) {
                const attrLineNumber = methodInfo.attributeCode.getLinesNumber();
                if(!attrLineNumber)
                    throw this.thisClass + '.' + methodInfo.name + ' have no LineNumber attribute';
                const linesNumber = attrLineNumber.linesNumber;
                for(let j = 0; j < linesNumber.length; j++) {
                    const pc = linesNumber[j].startPc;
                    const line = linesNumber[j].line;
                    const codeLength = (((j + 1) < linesNumber.length) ? linesNumber[j + 1].startPc : methodInfo.attributeCode.code.length);
                    ret.push(new FlintLineInfo(pc, line, codeLength, methodInfo, this));
                }
            }
        }

        if(this.innerClasses) {
            for(let i = 0; i < this.innerClasses.length; i++) {
                const innerClassLoader = FlintClassLoader.load(this.innerClasses[i]);
                ret.push(...innerClassLoader.getAllLineInfoSorted());
            }
        }

        ret.sort((a, b) => a.line - b.line);

        return ret;
    }

    public getAllLineInfoSorted(): FlintLineInfo[] {
        if(!this.lineInfoSorted)
            this.lineInfoSorted = this.createAndSortAllLineInfo();
        return this.lineInfoSorted;
    }

    public getSourcePath(): string | null {
        if(this.sourcePath == undefined)
            this.sourcePath = FlintClassLoader.findSourceFile(this.sourceFile);
        return this.sourcePath;
    }

    public getSource(): string | null {
        if(this.source == undefined)
            this.source = FlintClassLoader.findSourceFormModules(this.thisClass + ".java");
        return this.source;
    }

    private static readU16(data: Buffer, offset : number): number {
        let ret = data[offset + 1];
        ret |= data[offset] << 8;
        return ret;
    }

    private static readU32(data: Buffer, offset : number): number {
        let ret = data[offset + 3];
        ret |= data[offset + 2] << 8;
        ret |= data[offset + 1] << 16;
        ret |= data[offset] << 24;
        return ret;
    }

    private static readU64(data: Buffer, offset : number): bigint {
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
