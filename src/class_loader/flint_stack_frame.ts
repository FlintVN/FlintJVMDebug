
import { FlintLineInfo } from './flint_line_info'
import { FlintLocalVariable } from './flint_attribute_info'

export class FlintStackFrame {
    public readonly frameId: number;
    public readonly lineInfo: FlintLineInfo;
    public readonly isEndFrame: boolean;
    public readonly localVariables?: FlintLocalVariable[];

    public constructor(frameId: number, lineInfo: FlintLineInfo, isEndFrame: boolean, localVariables: FlintLocalVariable[] | undefined) {
        this.frameId = frameId;
        this.lineInfo = lineInfo;
        this.isEndFrame = isEndFrame;
        this.localVariables = localVariables;
    }

    public getLocalVariableInfo(variable: number | string): FlintLocalVariable | undefined {
        if(this.localVariables) {
            if(typeof variable === 'number') {
                if(variable < this.localVariables.length)
                    return this.localVariables[variable];
                return undefined;
            }
            else {
                for(let i = 0; i < this.localVariables.length; i++) {
                    if(this.localVariables[i].name === variable)
                        return this.localVariables[i];
                }
            }
        }
        return undefined;
    }
}
