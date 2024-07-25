
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

    private static getClassNameFormSource(source: string): string | undefined {
        const lastDotIndex = source.lastIndexOf('.');
        if(lastDotIndex < 0)
            return undefined;
        const extensionName = source.substring(lastDotIndex, source.length);
        if(extensionName.toLowerCase() !== '.java')
            return undefined;
        const fileNameWithoutExtension = source.substring(0, lastDotIndex);
        const workspace = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" : undefined;
        if(workspace && fileNameWithoutExtension.indexOf(workspace) === 0)
            return fileNameWithoutExtension.substring(workspace.length, fileNameWithoutExtension.length);
        return fileNameWithoutExtension;
    }

    public static getLineInfoFromPc(pc: number, className: string, method: string, descriptor: string): FlintLineInfo | undefined {
        const classLoader = FlintClassLoader.load(className);
        if(classLoader.sourcePath) {
            const methodInfo = classLoader.getMethodInfo(method, descriptor);
            if(methodInfo && methodInfo.attributeCode) {
                const attrLinesNumber = methodInfo.attributeCode.getLinesNumber();
                if(!attrLinesNumber)
                    return undefined;
                const linesNumber = attrLinesNumber.linesNumber;
                const length: number = linesNumber.length;
                for(let i = length - 1; i >= 0; i--) {
                    if(pc >= linesNumber[i].startPc) {
                        const line = linesNumber[i].line;
                        const codeLength = (((i + 1) < linesNumber.length) ? linesNumber[i + 1].startPc : methodInfo.attributeCode.code.length) - pc;
                        return new FlintLineInfo(pc, line, codeLength, classLoader.sourcePath, methodInfo, classLoader);
                    }
                }
            }
        }
        return undefined;
    }

    private static sortByLine(linesNumber: FlintLineNumber[]): [number, FlintLineNumber][] {
        const ret: [number, FlintLineNumber][] = [];
        for(let i = 0; i < linesNumber.length; i++)
            ret.push([i, linesNumber[i]]);
        ret.sort((a, b) => a[1].line - b[1].line);
        return ret;
    }

    public static getLineInfoFromLine(line: number, srcPath: string): FlintLineInfo | undefined {
        const className = this.getClassNameFormSource(srcPath);
        if(className) {
            const classLoader = FlintClassLoader.load(className);
            for(let i = 0; i < classLoader.methodsInfos.length; i++) {
                const methodInfo = classLoader.methodsInfos[i];
                if(methodInfo.attributeCode) {
                    const attrLineNumber = methodInfo.attributeCode.getLinesNumber();
                    if(!attrLineNumber)
                        return undefined;
                    const linesNumber = attrLineNumber.linesNumber;
                    const linesNumberSort = this.sortByLine(linesNumber);
                    if(linesNumberSort[linesNumberSort.length - 1][1].line < line)
                        continue;
                    for(let j = 0; j < linesNumberSort.length; j++) {
                        if(linesNumberSort[j][1].line >= line) {
                            const pc = linesNumberSort[j][1].startPc;
                            const index = linesNumberSort[j][0];
                            const codeLength = (((index + 1) < linesNumber.length) ? linesNumber[index + 1].startPc : methodInfo.attributeCode.code.length) - pc;
                            return new FlintLineInfo(pc, line, codeLength, srcPath, methodInfo, classLoader);
                        }
                    }
                }
            }
        }
        return undefined;
    }
}
