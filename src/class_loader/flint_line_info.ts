
import { FlintClassLoader } from './flint_class_loader';
import { FlintMethodInfo } from './flint_method_info';

export class FlintLineInfo {
    public readonly pc: number;
    public readonly line: number;
    public readonly codeLength: number;
    public readonly methodInfo: FlintMethodInfo;
    public readonly classLoader: FlintClassLoader;

    public constructor(pc: number, line: number, codeLength: number, methodInfo: FlintMethodInfo, classLoader: FlintClassLoader) {
        this.pc = pc;
        this.line = line;
        this.codeLength = codeLength;
        this.methodInfo = methodInfo;
        this.classLoader = classLoader;
    }

    public static getLineInfoFromPc(pc: number, className: string, method: string, descriptor: string): FlintLineInfo {
        const classLoader = FlintClassLoader.load(className);
        const methodInfo = classLoader.getMethodInfo(method, descriptor);
        if(!methodInfo || !methodInfo.attributeCode)
            throw 'Could load method ' + classLoader.thisClass + '.' + method;
        const attrLinesNumber = methodInfo.attributeCode.getLinesNumber();
        if(!attrLinesNumber)
            throw classLoader.thisClass + '.' + methodInfo.name + ' have no LineNumber attribute';
        const linesNumber = attrLinesNumber.linesNumber;
        const length: number = linesNumber.length;
        for(let i = length - 1; i >= 0; i--) {
            if(pc >= linesNumber[i].startPc) {
                const line = linesNumber[i].line;
                const codeLength = (((i + 1) < linesNumber.length) ? linesNumber[i + 1].startPc : methodInfo.attributeCode.code.length) - pc;
                return new FlintLineInfo(pc, line, codeLength, methodInfo, classLoader);
            }
        }
        throw 'Could get line infomation ' + classLoader.thisClass + '.' + method + '@' + pc;
    }

    public static getLineInfoFromLine(line: number, srcPath: string): FlintLineInfo | undefined {
        try {
            const className = FlintClassLoader.getClassNameFormSourceFileName(srcPath);
            const classLoader = FlintClassLoader.load(className);
            const linesNumber = classLoader.getAllLineInfoSorted();
            for(let i = 0; i < linesNumber.length; i++) {
                if(linesNumber[i].line >= line)
                    return linesNumber[i];
            }
            return undefined;
        }
        catch {
            return undefined;
        }
    }
}
