
import { FlintClassLoader } from './flint_class_loader';
import * as vscode from 'vscode';
import { FlintMethodInfo } from './flint_method_info';
import { FlintLineNumber } from './flint_attribute_info';

export class FlintLineInfo {
    public readonly pc: number;
    public readonly line: number;
    public readonly codeLength: number;
    public readonly methodInfo: FlintMethodInfo;
    public readonly classLoader: FlintClassLoader;
    public readonly sourcePath: string;

    private constructor(pc: number, line: number, codeLength: number, srcPath: string, methodInfo: FlintMethodInfo, classLoader: FlintClassLoader) {
        this.pc = pc;
        this.line = line;
        this.codeLength = codeLength;
        this.methodInfo = methodInfo;
        this.classLoader = classLoader;
        this.sourcePath = srcPath;
    }

    public static getLineInfoFromPc(pc: number, className: string, method: string, descriptor: string): FlintLineInfo {
        const classLoader = FlintClassLoader.load(className);
        if(classLoader.sourcePath) {
            const methodInfo = classLoader.getMethodInfo(method, descriptor);
            if(methodInfo && methodInfo.attributeCode) {
                const attrLinesNumber = methodInfo.attributeCode.getLinesNumber();
                if(!attrLinesNumber)
                    throw classLoader.thisClass + '.' + methodInfo.name + ' have no LineNumber attribute';
                const linesNumber = attrLinesNumber.linesNumber;
                const length: number = linesNumber.length;
                for(let i = length - 1; i >= 0; i--) {
                    if(pc >= linesNumber[i].startPc) {
                        const line = linesNumber[i].line;
                        const codeLength = (((i + 1) < linesNumber.length) ? linesNumber[i + 1].startPc : methodInfo.attributeCode.code.length) - pc;
                        return new FlintLineInfo(pc, line, codeLength, classLoader.sourcePath, methodInfo, classLoader);
                    }
                }
                throw 'Could get line infomation ' + classLoader.thisClass + '.' + method + '@' + pc;
            }
            else
                throw 'Could load method ' + classLoader.thisClass + '.' + method;
        }
        else
            throw 'Could find source file for ' + className;
    }

    private static sortByLine(linesNumber: FlintLineInfo[]): FlintLineInfo[] {
        return linesNumber.sort((a, b) => a.line - b.line);
    }

    private static getAllLineInfo(classLoader: FlintClassLoader): FlintLineInfo[] {
        const ret: FlintLineInfo[] = [];

        for(let i = 0; i < classLoader.methodsInfos.length; i++) {
            const methodInfo = classLoader.methodsInfos[i];
            if(methodInfo.attributeCode) {
                const attrLineNumber = methodInfo.attributeCode.getLinesNumber();
                if(!attrLineNumber)
                    throw classLoader.thisClass + '.' + methodInfo.name + ' have no LineNumber attribute';
                const linesNumber = attrLineNumber.linesNumber;
                for(let j = 0; j < linesNumber.length; j++) {
                    const pc = linesNumber[j].startPc;
                    const line = linesNumber[j].line;
                    const srcPath = classLoader.sourcePath as string;
                    const codeLength = (((j + 1) < linesNumber.length) ? linesNumber[j + 1].startPc : methodInfo.attributeCode.code.length);
                    ret.push(new FlintLineInfo(pc, line, codeLength, srcPath, methodInfo, classLoader));
                }
            }
        }

        if(classLoader.innerClasses) {
            for(let i = 0; i < classLoader.innerClasses.length; i++) {
                const innerClassLoader = FlintClassLoader.load(classLoader.innerClasses[i]);
                const tmp = this.getAllLineInfo(innerClassLoader);
                for(let j = 0; j < tmp.length; j++)
                    ret.push(tmp[j]);
            }
        }

        return ret;
    }

    public static getLineInfoFromLine(line: number, srcPath: string): FlintLineInfo | undefined {
        const className = FlintClassLoader.getClassNameFormSource(srcPath);
        const classLoader = FlintClassLoader.load(className);
        const linesNumber = this.getAllLineInfo(classLoader);
        this.sortByLine(linesNumber);
        for(let i = 0; i < linesNumber.length; i++) {
            if(linesNumber[i].line >= line)
                return linesNumber[i];
        }
        return undefined;
    }
}
