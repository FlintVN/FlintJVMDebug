
import {
    StackFrame, Source,
    Variable
} from '@vscode/debugadapter';
import fs = require('fs');
import { FlintSemaphore } from './flint_semaphone';
import { FlintVariableValue } from './flint_value_info';
import { FlintDataResponse } from './flint_data_response';
import { FlintExceptionInfo } from './flint_exception_info';
import { FlintLineInfo } from './class_loader/flint_line_info'
import { FlintStackFrame } from './class_loader/flint_stack_frame';
import { FlintClassLoader } from './class_loader/flint_class_loader';
import { FlintFieldInfo } from './class_loader/flint_field_info';
import { FlintClient } from './flint_client';
import { FlintDbgCmd} from './flint_debug_enum_types';
import { FlintFileMode } from './flint_debug_enum_types';
import { FlintDbgRespCode } from './flint_debug_enum_types';

export class FlintClientDebugger {
    private static readonly DBG_STATUS_STOP: number = 0x01;
    private static readonly DBG_STATUS_STOP_SET: number = 0x02;
    private static readonly DBG_STATUS_EXCP: number = 0x04;
    private static readonly DBG_STATUS_CONSOLE: number = 0x08;
    private static readonly DBG_STATUS_DONE: number = 0x40;
    private static readonly DBG_STATUS_RESET: number = 0x80;

    private static TCP_TIMEOUT_DEFAULT: number = 200;
    private static READ_STATUS_INVERVAL: number = 100;

    private readonly client: FlintClient;

    private rxData?: Buffer;
    private rxDataLengthReceived: number = 0;

    private requestStatusTask?: NodeJS.Timeout;
    private requestConsoleTask?: NodeJS.Timeout;

    private currentStatus: number = FlintClientDebugger.DBG_STATUS_STOP;
    private currentStackFrames?: FlintStackFrame[];
    private currentBreakpoints: FlintLineInfo[] = [];

    private tcpSemaphore = new FlintSemaphore(1);

    private variableReferenceMap = new Map<number, FlintVariableValue>;

    private stopCallback?: (reason?: string) => void;
    private errorCallback?: () => void;
    private closeCallback?: () => void;
    private stdoutCallback?: (data: string) => void;
    private receivedCallback?: (response: FlintDataResponse) => void;

    public constructor(client: FlintClient) {
        this.client = client;

        this.client.on('data', (data: Buffer) => {
            if(this.receivedCallback) {
                if(!this.rxData) {
                    const dataLength = data[1] | (data[2] << 8) | (data[3] << 16);
                    this.rxData = Buffer.alloc(dataLength);
                    data.copy(this.rxData, 0);
                    this.rxDataLengthReceived += dataLength;
                }
                else {
                    data.copy(this.rxData, this.rxDataLengthReceived);
                    this.rxDataLengthReceived += data.length;
                }
                if(this.rxDataLengthReceived >= this.rxData.length) {
                    const cmd = this.rxData[0] & 0x7F;
                    const responseCode = this.rxData[4];
                    const crc1 = this.rxData[this.rxData.length - 2] | (this.rxData[this.rxData.length - 1] << 8);
                    const data = Buffer.alloc(this.rxData.length - 7);
                    this.rxData.copy(data, 0, 5);
                    let crc2 = 0;
                    for(let i = 0; i < this.rxData.length - 2; i++)
                        crc2 += this.rxData[i];
                    this.rxData = undefined;
                    if(crc1 === crc2)
                        this.receivedCallback(new FlintDataResponse(cmd, responseCode, data));
                    this.receivedCallback = undefined;
                }
            }
        });

        this.client.on('error', (err) => {
            if(this.errorCallback)
                this.errorCallback();
        });

        this.client.on('close', () => {
            if(this.closeCallback) {
                if(this.requestConsoleTask) {
                    clearTimeout(this.requestConsoleTask);
                    this.requestConsoleTask = undefined;
                }
                if(this.requestStatusTask) {
                    clearTimeout(this.requestStatusTask);
                    this.requestStatusTask = undefined;
                }
                this.closeCallback();
            }
        });
    }

    private startReadStatusTask() {
        const timeoutCallback = async () => {
            if(this.client.isConnected() === true) {
                const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_READ_STATUS);
                if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_READ_STATUS && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK) {
                    const status = resp.data[0];
                    if(!(status & FlintClientDebugger.DBG_STATUS_RESET)) {
                        const tmp = this.currentStatus;
                        this.currentStatus = status;
                        if((this.currentStatus & (FlintClientDebugger.DBG_STATUS_DONE | FlintClientDebugger.DBG_STATUS_RESET)) === FlintClientDebugger.DBG_STATUS_DONE) {
                            if(this.stopCallback)
                                this.stopCallback('done');
                        }
                        else if((this.currentStatus & FlintClientDebugger.DBG_STATUS_STOP_SET) && (this.currentStatus & FlintClientDebugger.DBG_STATUS_STOP)) {
                            this.currentStackFrames = undefined;
                            if(this.stopCallback) {
                                let reason = undefined;
                                if(this.currentStatus & FlintClientDebugger.DBG_STATUS_EXCP)
                                    reason = 'exception';
                                this.stopCallback(reason);
                            }
                        }
                        else if((tmp & FlintClientDebugger.DBG_STATUS_STOP) !== (this.currentStatus & FlintClientDebugger.DBG_STATUS_STOP)) {
                            this.currentStackFrames = undefined;
                            if(this.stopCallback && (this.currentStatus & FlintClientDebugger.DBG_STATUS_STOP))
                                this.stopCallback();
                        }
                    }
                }
                this.requestStatusTask = setTimeout(timeoutCallback, FlintClientDebugger.READ_STATUS_INVERVAL);
            }
        };
        this.requestStatusTask = setTimeout(timeoutCallback, FlintClientDebugger.READ_STATUS_INVERVAL);
    }

    private startReadConsoleTask() {
        const timeoutCallback = async () => {
            if(this.stdoutCallback && this.client.isConnected() === true) {
                if(this.currentStatus & FlintClientDebugger.DBG_STATUS_CONSOLE) {
                    const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_READ_CONSOLE);
                    if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_READ_CONSOLE && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK) {
                        if(resp.data.length > 0) {
                            const text = resp.data.toString('utf-8');
                            this.stdoutCallback(text);
                        }
                    }
                }
                this.requestConsoleTask = setTimeout(timeoutCallback, FlintClientDebugger.READ_STATUS_INVERVAL * 3);
            }
        };
        this.requestConsoleTask = setTimeout(timeoutCallback, FlintClientDebugger.READ_STATUS_INVERVAL * 3);
    }

    public startCheckStatus() {
        this.startReadStatusTask();
        this.startReadConsoleTask();
    }

    private onReceived(callback: (response: FlintDataResponse) => void) {
        this.receivedCallback = callback;
    }

    private removeReceivedListeners() {
        this.receivedCallback = undefined;
        this.rxData = undefined;
    }

    public on(event: 'stop', callback: (reason?: string) => void): this;
    public on(event: 'error', callback: () => void): this;
    public on(event: 'close', callback: () => void): this;
    public on(event: 'stdout', callback: (data: string) => void): this;

    public on(event: string, callback: Function): this {
        if(event === 'stop')
            this.stopCallback = callback as ((reason?: string) => void);
        else if(event === 'error')
            this.errorCallback = callback as (() => void);
        else if(event === 'close')
            this.closeCallback = callback as (() => void);
        else if(event === 'stdout')
            this.stdoutCallback = callback as ((data: string) => void);
        return this;
    }

    public removeAllListeners() {
        this.stopCallback = undefined;
        this.errorCallback = undefined;
        this.closeCallback = undefined;
    }

    public async connect() {
        await this.client.connect();
    }

    private sendCmd(cmd: FlintDbgCmd, data?: Buffer, timeout: number = FlintClientDebugger.TCP_TIMEOUT_DEFAULT): Promise<FlintDataResponse | undefined> {
        return new Promise((resolve) => {
            this.tcpSemaphore.acquire().then(() => {
                const length = 1 + 3 + (data ? data.length : 0) + 2;
                const txData = Buffer.alloc(length);
                txData[0] = cmd;
                txData[1] = (length >>> 0) & 0xFF;
                txData[2] = (length >>> 8) & 0xFF;
                txData[3] = (length >>> 16) & 0xFF;
                let crc = txData[0] + txData[1] + txData[2] + txData[3];
                if(data) for(let i = 0; i < data.length; i++) {
                    txData[i + 4] = data[i];
                    crc += data[i];
                }
                txData[txData.length - 2] = (crc >>> 0) & 0xFF;
                txData[txData.length - 1] = (crc >>> 8) & 0xFF;
                const timeoutTask = setTimeout(() => {
                    this.removeReceivedListeners();
                    this.tcpSemaphore.release();
                    resolve(undefined);
                }, timeout);
                this.onReceived((resp) => {
                    this.tcpSemaphore.release();
                    clearTimeout(timeoutTask);
                    resolve(resp);
                });
                if(!this.client.write(txData)) {
                    this.removeReceivedListeners();
                    this.tcpSemaphore.release();
                    clearTimeout(timeoutTask);
                    resolve(undefined);
                }
            });
        });
    }

    public async enterDebugMode(): Promise<boolean> {
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_ENTER_DEBUG, undefined, 100);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_ENTER_DEBUG && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    public async run(): Promise<boolean> {
        this.currentStackFrames = undefined;
        if(!(this.currentStatus & FlintClientDebugger.DBG_STATUS_STOP))
            return true;
        else {
            const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_RUN);
            if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_RUN && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
                return true;
            else
                return false;
        }
    }

    public async stop(): Promise<boolean> {
        this.currentStackFrames = undefined;
        if(this.currentStatus & FlintClientDebugger.DBG_STATUS_STOP)
            return true;
        else {
            const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_STOP);
            if(!(resp && resp.cmd === FlintDbgCmd.DBG_CMD_STOP && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK))
                return false;
            else
                return true;
        };
    }

    private static calcCrc(str: string): number {
        let crc: number = 0;
        for(let i = 0; i < str.length; i++)
            crc += str.charCodeAt(i);
        return crc;
    }

    private static putConstUtf8ToBuffer(buff: Buffer, str: string, offset: number): number {
        buff[offset++] = (str.length >>> 0) & 0xFF;
        buff[offset++] = (str.length >>> 8) & 0xFF;
        const crc = this.calcCrc(str);
        buff[offset++] = (crc >>> 0) & 0xFF;
        buff[offset++] = (crc >>> 8) & 0xFF;
        const data = Buffer.from(str);
        data.copy(buff, offset);
        return offset + data.length + 1;
    }

    public async removeAllBreakPoints(): Promise<boolean> {
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_REMOVE_ALL_BKP);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_REMOVE_ALL_BKP && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    private getRemoveBreakpointList(lines: number[], source: string): FlintLineInfo[] {
        const ret: FlintLineInfo[] = [];
        for(let i = 0; i < this.currentBreakpoints.length; i++) {
            if(source === this.currentBreakpoints[i].sourcePath) {
                let isContain = false;
                for(let j = 0; j < lines.length; j++) {
                    if(this.currentBreakpoints[i].line === lines[j]) {
                        isContain = true;
                        break;
                    }
                }
                if(!isContain)
                    ret.push(this.currentBreakpoints[i]);
            }
        }
        return ret;
    }

    private getAddBreakpointList(lines: number[], source: string): FlintLineInfo[] {
        const ret: FlintLineInfo[] = [];
        for(let i = 0; i < lines.length; i++) {
            let isContain = false;
            for(let j = 0; j < this.currentBreakpoints.length; j++) {
                if(source === this.currentBreakpoints[j].sourcePath && this.currentBreakpoints[j].line === lines[i]) {
                    isContain = true;
                    break;
                }
            }
            if(!isContain) {
                const lineInfo = FlintLineInfo.getLineInfoFromLine(lines[i], source);
                ret.push(lineInfo);
            }
        }
        return ret;
    }

    private async removeBreakPoints(lineInfo: FlintLineInfo[]): Promise<boolean> {
        for(let i = 0; i < lineInfo.length; i++) {
            const line = lineInfo[i];
            const className = line.classLoader.thisClass.replace(/\\/g, '/');
            const methodName = line.methodInfo.name;
            const descriptor = line.methodInfo.descriptor;
            let bufferSize = 4;
            bufferSize += 4 + className.length + 1;
            bufferSize += 4 + methodName.length + 1;
            bufferSize += 4 + descriptor.length + 1;

            const txBuff = Buffer.alloc(bufferSize);
            let index = 0;

            /* pc value */
            txBuff[index++] = (line.pc >>> 0) & 0xFF;
            txBuff[index++] = (line.pc >>> 8) & 0xFF;
            txBuff[index++] = (line.pc >>> 16) & 0xFF;
            txBuff[index++] = (line.pc >>> 24) & 0xFF;

            /* class name */
            index = FlintClientDebugger.putConstUtf8ToBuffer(txBuff, className, index);

            /* method name */
            index = FlintClientDebugger.putConstUtf8ToBuffer(txBuff, methodName, index);

            /* descriptor */
            index = FlintClientDebugger.putConstUtf8ToBuffer(txBuff, descriptor, index);

            const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_REMOVE_BKP, txBuff);
            if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_REMOVE_BKP && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK) {
                const index = this.currentBreakpoints.findIndex(item => item === line);
                this.currentBreakpoints.splice(index, 1);
            }
            else
                return false;
        }
        return true;
    }

    private async addBreakPoints(lineInfo: FlintLineInfo[]): Promise<boolean> {
        for(let i = 0; i < lineInfo.length; i++) {
            const line = lineInfo[i];
            const className = line.classLoader.thisClass.replace(/\\/g, '/');
            const methodName = line.methodInfo.name;
            const descriptor = line.methodInfo.descriptor;
            let bufferSize = 4;
            bufferSize += 4 + className.length + 1;
            bufferSize += 4 + methodName.length + 1;
            bufferSize += 4 + descriptor.length + 1;

            const txBuff = Buffer.alloc(bufferSize);
            let index = 0;

            /* pc value */
            txBuff[index++] = (line.pc >>> 0) & 0xFF;
            txBuff[index++] = (line.pc >>> 8) & 0xFF;
            txBuff[index++] = (line.pc >>> 16) & 0xFF;
            txBuff[index++] = (line.pc >>> 24) & 0xFF;

            /* class name */
            index = FlintClientDebugger.putConstUtf8ToBuffer(txBuff, className, index);

            /* method name */
            index = FlintClientDebugger.putConstUtf8ToBuffer(txBuff, methodName, index);

            /* descriptor */
            index = FlintClientDebugger.putConstUtf8ToBuffer(txBuff, descriptor, index);

            const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_ADD_BKP, txBuff);
            if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_ADD_BKP && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
                this.currentBreakpoints.push(line);
            else
                return false;
        }
        return true;
    }

    public async setExceptionBreakPointsRequest(isEnabled: boolean): Promise<boolean> {
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_SET_EXCP_MODE, Buffer.from([isEnabled ? 1 : 0]));
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_SET_EXCP_MODE && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    public async readExceptionInfo(): Promise<FlintExceptionInfo | undefined> {
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_READ_EXCP_INFO);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_READ_EXCP_INFO && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK) {
            let index = 0;
            const typeLength = FlintClientDebugger.readU16(resp.data, index);
            index += 4;
            const type = resp.data.toString('utf-8', index, index + typeLength);
            index += typeLength + 1;
            const messageLength = FlintClientDebugger.readU16(resp.data, index);
            index += 4;
            const message = resp.data.toString('utf-8', index, index + messageLength);
            return new FlintExceptionInfo(type, message);
        }
        else
            return undefined;
    }

    public async setBreakPointsRequest(lines: number[], source: string): Promise<boolean> {
        let bkps = this.getRemoveBreakpointList(lines, source);
        if(bkps.length > 0) {
            const value = await this.removeBreakPoints(bkps);
            if(!value)
                return false;
        }
        bkps = this.getAddBreakpointList(lines, source);
        if(bkps.length > 0)
            return await this.addBreakPoints(bkps);
        return true;
    }

    private async readStackFrame(frameId: number): Promise<FlintStackFrame | undefined> {
        const txData: Buffer = Buffer.alloc(4);
        txData[0] = frameId & 0xFF;
        txData[1] = (frameId >>> 8) & 0xFF;
        txData[2] = (frameId >>> 16) & 0xFF;
        txData[3] = (frameId >>> 24) & 0xFF;
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_READ_STACK_TRACE, txData);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_READ_STACK_TRACE && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK) {
            let index = 0;
            const currentStack = FlintClientDebugger.readU32(resp.data, index);
            const currentStackIndex = currentStack & 0x7FFFFFFF;
            const isEndStack = (currentStack & 0x80000000) ? true : false;
            if(currentStackIndex !== frameId)
                return undefined;
            index += 4;
            const pc = FlintClientDebugger.readU32(resp.data, index);
            index += 4;
            const classNameLength = FlintClientDebugger.readU16(resp.data, index);
            index += 2 + 2;
            const className = resp.data.toString('utf-8', index, index + classNameLength);
            index += classNameLength + 1;
            const nameLength = FlintClientDebugger.readU16(resp.data, index);
            index += 2 + 2;
            const name = resp.data.toString('utf-8', index, index + nameLength);
            index += nameLength + 1;
            const descriptorLength = FlintClientDebugger.readU16(resp.data, index);
            index += 2 + 2;
            const descriptor = resp.data.toString('utf-8', index, index + descriptorLength);

            const lineInfo = FlintLineInfo.getLineInfoFromPc(pc, className, name, descriptor);
            const methodInfo = lineInfo.methodInfo;
            let localVar = undefined;
            if(methodInfo.attributeCode) {
                const localVarAttr = methodInfo.attributeCode.getLocalVariables();
                if(localVarAttr) {
                    localVar = [];
                    for(let i = 0; i < localVarAttr.localVariables.length; i++) {
                        const tmp = localVarAttr.localVariables[i];
                        if(tmp.startPc <= pc && pc < (tmp.startPc + tmp.length))
                            localVar.push(tmp);
                    }
                    if(localVar.length === 0)
                        localVar = undefined;
                }
            }
            return new FlintStackFrame(frameId, lineInfo, isEndStack, localVar);
        }
        return undefined;
    }

    public async restartRequest(mainClass: string): Promise<boolean> {
        const txBuff = Buffer.alloc(5 + mainClass.length);
        FlintClientDebugger.putConstUtf8ToBuffer(txBuff, mainClass, 0);
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_RESTART, txBuff, 5000);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_RESTART && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    public async terminateRequest(includeDebugger: boolean): Promise<boolean> {
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_TERMINATE, Buffer.from([includeDebugger ? 1 : 0]), 5000);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_TERMINATE && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    private async stepRequest(stepCmd: number, stepCodeLength: number): Promise<boolean> {
        this.currentStackFrames = undefined;
        const txData = Buffer.alloc(4);
        txData[0] = stepCodeLength & 0xFF;
        txData[1] = (stepCodeLength >>> 8) & 0xFF;
        txData[2] = (stepCodeLength >>> 16) & 0xFF;
        txData[3] = (stepCodeLength >>> 24) & 0xFF;
        const resp = await this.sendCmd(stepCmd, txData);
        if(resp && resp.cmd === stepCmd && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    public async stepInRequest(): Promise<boolean> {
        if(this.currentStackFrames)
            return await this.stepRequest(FlintDbgCmd.DBG_CMD_STEP_IN, this.currentStackFrames[0].lineInfo.codeLength);
        else {
            const currentPoint = await this.readStackFrame(0);
            if(!currentPoint)
                return false;
            else
                return await this.stepRequest(FlintDbgCmd.DBG_CMD_STEP_IN, currentPoint.lineInfo.codeLength);
        }
    }

    public async stepOverRequest(): Promise<boolean> {
        if(this.currentStackFrames)
            return await this.stepRequest(FlintDbgCmd.DBG_CMD_STEP_OVER, this.currentStackFrames[0].lineInfo.codeLength);
        else {
            const currentPoint = await this.readStackFrame(0);
            if(!currentPoint)
                return false;
            else
                return await this.stepRequest(FlintDbgCmd.DBG_CMD_STEP_OVER, currentPoint.lineInfo.codeLength);
        };
    }

    public async stepOutRequest(): Promise<boolean> {
        return await this.stepRequest(FlintDbgCmd.DBG_CMD_STEP_OUT, 0);
    }

    private static getSimpleNames(name: string): string[] {
        const ret: string[] = [];
        let index = 0;
        let simpleName = '';
        while(index < name.length) {
            let arrayCount = 0;
            let ch = name.charAt(index++);
            while(ch === '[') {
                arrayCount++;
                ch = name.charAt(index++);
            }
            if(ch !== 'L') {
                if(ch === 'Z')
                    simpleName = "boolean";
                else if(ch === 'C')
                    simpleName = "char";
                else if(ch === 'F')
                    simpleName = "float";
                else if(ch === 'D')
                    simpleName = "double";
                else if(ch === 'B')
                    simpleName = "byte";
                else if(ch === 'S')
                    simpleName = "short";
                else if(ch === 'I')
                    simpleName = "int";
                else if(ch === 'J')
                    simpleName = "long";
                else
                    simpleName = ch;
            }
            else {
                ch = name.charAt(index++);
                while(ch !== ';') {
                    simpleName += ch;
                    ch = name.charAt(index++);
                }
            }
            if(arrayCount > 0)
                simpleName = simpleName.concat("[]".repeat(arrayCount));
            ret.push(simpleName);
        }
        return ret;
    }

    private static getShortenName(name: string): string {
        let dotIndexLastIndex = name.lastIndexOf('\/');
        if(dotIndexLastIndex < 0)
            dotIndexLastIndex = name.lastIndexOf('.');
        if(dotIndexLastIndex >= 0)
            return name.substring(dotIndexLastIndex + 1);
        return name;
    }

    private static convertToStackFrame(stackFrames: FlintStackFrame[]): StackFrame[] {
        const ret: StackFrame[] = [];
        for(let i = 0; i < stackFrames.length; i++) {
            const lineInfo = stackFrames[i].lineInfo;
            const src = new Source(lineInfo.classLoader.thisClass + ".java", lineInfo.sourcePath);
            let methodName = lineInfo.classLoader.thisClass;
            let dotIndexLastIndex = methodName.lastIndexOf('\/');
            dotIndexLastIndex = (dotIndexLastIndex < 0) ? 0 : (dotIndexLastIndex + 1);
            methodName = methodName.substring(dotIndexLastIndex, methodName.length);
            methodName += '.' + lineInfo.methodInfo.name + '(';
            const descriptor = lineInfo.methodInfo.descriptor;
            const names = this.getSimpleNames(descriptor.substring(1, descriptor.lastIndexOf(')')));
            for(let i = 0; i < names.length; i++) {
                methodName += this.getShortenName(names[i]);
                if((i + 1) < names.length)
                    methodName += ', ';
            }
            methodName += ')';
            const sf = new StackFrame(stackFrames[i].frameId, methodName, src, lineInfo.line);
            sf.instructionPointerReference = lineInfo.pc.toString();
            ret.push(sf);
        }
        return ret;
    }

    private addToRefMap(valueInfo: FlintVariableValue) {
        if((!FlintClientDebugger.isPrimType(valueInfo.type)) && (typeof valueInfo.value == 'number')) {
            const reference = valueInfo.value as number;
            if(reference !== 0) {
                if(!this.variableReferenceMap.has(reference))
                    this.variableReferenceMap.set(reference, valueInfo);
            }
        }
    }

    public async stackFrameRequest(): Promise<StackFrame[] | undefined> {
        if(this.currentStackFrames)
            return FlintClientDebugger.convertToStackFrame(this.currentStackFrames);
        else {
            const ret: FlintStackFrame[] = [];
            let frameId = 0;
            while(true) {
                const stackFrame = await this.readStackFrame(frameId);
                if(stackFrame && stackFrame.lineInfo.sourcePath) {
                    ret.push(stackFrame);
                    if(stackFrame.isEndFrame) {
                        this.currentStackFrames = ret;
                        return FlintClientDebugger.convertToStackFrame(this.currentStackFrames);
                    }
                    else
                        frameId++;
                }
                else
                    return undefined;
            }
        }
    }

    private static isPrimType(descriptor: string): boolean {
        if(descriptor.length === 1) {
            switch(descriptor) {
                case 'Z':
                case 'C':
                case 'F':
                case 'D':
                case 'B':
                case 'S':
                case 'I':
                case 'J':
                    return true;
                default:
                    return false;
            }
        }
        return false;
    }

    private static isArrayType(descriptor: string): boolean {
        if(descriptor.length >= 1) {
            switch(descriptor.charAt(0)) {
                case '[':
                    return true;
                default:
                    return false;
            }
        }
        return false;
    }

    private static getElementTypeSize(arrayDescriptor: string): number {
        let index = 0;
        if(arrayDescriptor.charAt(index) === '[')
            index++;
        switch(arrayDescriptor.charAt(index)) {
            case 'Z':
            case 'B':
                return 1;
            case 'C':
            case 'S':
                return 2;
            case 'J':
            case 'D':
                return 8;
            default:
                return 4;
        }
    }

    private static binaryToInt32(binary: number): number {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setUint32(0, binary);
        return view.getInt32(0);
    }

    private static binaryToFloat32(binary: number): number {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setUint32(0, binary);
        return view.getFloat32(0);
    }

    private static binaryToInt64(binary: bigint): bigint {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setUint32(0, Number(binary >> 32n));
        view.setUint32(4, Number(binary & 0xFFFFFFFFn));
        return view.getBigInt64(0);
    }

    private static binaryToFloat64(binary: bigint): number {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setUint32(0, Number(binary >> 32n));
        view.setUint32(4, Number(binary & 0xFFFFFFFFn));
        return view.getFloat64(0);
    }

    private static getPrimDisplayValue(value: number | bigint, descriptor: string): number | bigint | string {
        if(descriptor === 'F')
            return this.binaryToFloat32(value as number);
        else if(descriptor === 'D')
            return this.binaryToFloat64(value as bigint);
        else if(descriptor === 'C')
            return '\'' + String.fromCharCode(value as number) + '\'';
        else if(descriptor === 'Z')
            return (value === 0) ? 'false' : 'true';
        else if(descriptor === 'J')
            return this.binaryToInt64(value as bigint);
        else
            return this.binaryToInt32(value as number);
    }

    private async convertToVariable(valueInfos: FlintVariableValue[]) : Promise<Variable[]> {
        const ret: Variable[] = [];
        for(let i = 0; i < valueInfos.length; i++) {
            if(FlintClientDebugger.isPrimType(valueInfos[i].type)) {
                const displayValue = FlintClientDebugger.getPrimDisplayValue(valueInfos[i].value as number | bigint, valueInfos[i].type);
                ret.push({name: valueInfos[i].name, value: displayValue.toString(), variablesReference: 0});
            }
            else {
                let reference = 0;
                let displayValue;
                if(valueInfos[i].value === undefined)
                    displayValue = 'not available';
                else if(valueInfos[i].value === 0)
                    displayValue = 'null';
                else if(FlintClientDebugger.isArrayType(valueInfos[i].type)) {
                    const arrayLength = valueInfos[i].size / FlintClientDebugger.getElementTypeSize(valueInfos[i].type);
                    let type = FlintClientDebugger.getSimpleNames(valueInfos[i].type)[0];
                    type = FlintClientDebugger.getShortenName(type);
                    type = type.replace('[]', '[' + arrayLength + ']');
                    displayValue = type;
                    reference = valueInfos[i].value as number;
                }
                else {
                    const str = await this.checkAndReadString(valueInfos[i].value as number, valueInfos[i].type);
                    if(str !== undefined)
                        displayValue = str;
                    else {
                        let type = FlintClientDebugger.getSimpleNames(valueInfos[i].type)[0];
                        type = FlintClientDebugger.getShortenName(type);
                        displayValue = type;
                    }
                    reference = valueInfos[i].value as number;
                }
                ret.push({name: valueInfos[i].name, value: displayValue.toString(), variablesReference: reference});
            }
        }
        return ret;
    }

    public async readLocalVariables(frameId: number): Promise<Variable[] | undefined> {
        this.variableReferenceMap.clear();

        let stackFrame: FlintStackFrame;
        if(this.currentStackFrames && this.currentStackFrames.length > frameId)
            stackFrame = this.currentStackFrames[frameId];
        else {
            const tmp = await this.readStackFrame(frameId);
            if(tmp === undefined)
                return undefined;
            stackFrame = tmp;
        };

        if(stackFrame.localVariables === undefined)
            return undefined;
        const valueInfos: FlintVariableValue[] = [];
        for(let i = 0; i < stackFrame.localVariables.length; i++) {
            const result = await this.readLocalRequest(stackFrame, i);
            if(result === undefined) {
                const name = stackFrame.localVariables[i].name;
                const descriptor = stackFrame.localVariables[i].descriptor;
                valueInfos.push(new FlintVariableValue(name, descriptor, undefined, 0));
            }
            else
                valueInfos.push(result);
        }
        return await this.convertToVariable(valueInfos);
    }

    public async readVariable(reference: number): Promise<Variable[] | undefined> {
        const variableValue = await this.readVariableRequest(reference);
        if(variableValue !== undefined)
            return this.convertToVariable(variableValue);
        return undefined;
    }

    public async readField(reference: number, fieldName: string): Promise<Variable | undefined> {
        const variableValue = await this.readVariable(reference);
        if(variableValue !== undefined)
            return variableValue.find((item) => item.name === fieldName) as Variable;
        return undefined;
    }

    private async readLocalRequest(stackFrame: FlintStackFrame, variable: number | string): Promise<FlintVariableValue | undefined> {
        const localVariableInfo = stackFrame.getLocalVariableInfo(variable);
        if(!localVariableInfo)
            return undefined;
        const isU64 = localVariableInfo.descriptor === 'J' || localVariableInfo.descriptor === 'D'
        const txBuff = Buffer.alloc(8);
        const frameId = (stackFrame.frameId & 0x7FFFFFFF) | (isU64 ? 0x80000000 : 0x00);
        txBuff[0] = (frameId >>> 0) & 0xFF;
        txBuff[1] = (frameId >>> 8) & 0xFF;
        txBuff[2] = (frameId >>> 16) & 0xFF;
        txBuff[3] = (frameId >>> 24) & 0xFF;
        txBuff[4] = (localVariableInfo.index >>> 0) & 0xFF;
        txBuff[5] = (localVariableInfo.index >>> 8) & 0xFF;
        txBuff[6] = (localVariableInfo.index >>> 16) & 0xFF;
        txBuff[7] = (localVariableInfo.index >>> 24) & 0xFF;
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_READ_LOCAL, txBuff);
        if(!(resp && resp.cmd === FlintDbgCmd.DBG_CMD_READ_LOCAL && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK))
            return undefined;
        const size = FlintClientDebugger.readU32(resp.data, 0);
        let value: number | bigint = isU64 ? FlintClientDebugger.readU64(resp.data, 4) : FlintClientDebugger.readU32(resp.data, 4);
        const name = localVariableInfo.name;
        if(FlintClientDebugger.isPrimType(localVariableInfo.descriptor))
            return new FlintVariableValue(name, localVariableInfo.descriptor, value, size);
        else {
            let type: string;
            if(!isU64 && resp.data.length > 13) {
                const typeLength = FlintClientDebugger.readU16(resp.data, 8);
                type = resp.data.toString('utf-8', 12, 12 + typeLength);
            }
            else
                type = localVariableInfo.descriptor;
            const reference = value as number;
            const ret = new FlintVariableValue(name, type, reference, size);
            this.addToRefMap(ret);
            return ret;
        }
    }

    private async readFieldRequest(reference: number, fieldInfo: FlintFieldInfo): Promise<FlintVariableValue | undefined> {
        const txBuff = Buffer.alloc(4 + 4 + fieldInfo.name.length + 1);
        txBuff[0] = (reference >>> 0) & 0xFF;
        txBuff[1] = (reference >>> 8) & 0xFF;
        txBuff[2] = (reference >>> 16) & 0xFF;
        txBuff[3] = (reference >>> 24) & 0xFF;
        FlintClientDebugger.putConstUtf8ToBuffer(txBuff, fieldInfo.name, 4);
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_READ_FIELD, txBuff);
        if(!(resp && resp.cmd === FlintDbgCmd.DBG_CMD_READ_FIELD && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK))
            return undefined;
        const isU64 = fieldInfo.descriptor === 'J' || fieldInfo.descriptor === 'D';
        const size = FlintClientDebugger.readU32(resp.data, 0);
        let value: number | bigint = isU64 ? FlintClientDebugger.readU64(resp.data, 4) : FlintClientDebugger.readU32(resp.data, 4);
        const name = fieldInfo.name;
        if(FlintClientDebugger.isPrimType(fieldInfo.descriptor))
            return new FlintVariableValue(name, fieldInfo.descriptor, value, size);
        else {
            let type: string;
            if(!isU64 && resp.data.length > 13) {
                const typeLength = FlintClientDebugger.readU16(resp.data, 8);
                type = resp.data.toString('utf-8', 12, 12 + typeLength);
            }
            else
                type = fieldInfo.descriptor;
            const reference = value as number;
            const ret = new FlintVariableValue(name, type, reference, size);
            this.addToRefMap(ret);
            return ret;
        }
    }

    private async readArrayRequest(reference: number, index: number, length: number, arrayType: string): Promise<FlintVariableValue[] | undefined> {
        const txBuff = Buffer.alloc(12);
        txBuff[0] = (length >>> 0) & 0xFF;
        txBuff[1] = (length >>> 8) & 0xFF;
        txBuff[2] = (length >>> 16) & 0xFF;
        txBuff[3] = (length >>> 24) & 0xFF;
        txBuff[4] = (index >>> 0) & 0xFF;
        txBuff[5] = (index >>> 8) & 0xFF;
        txBuff[6] = (index >>> 16) & 0xFF;
        txBuff[7] = (index >>> 24) & 0xFF;
        txBuff[8] = (reference >>> 0) & 0xFF;
        txBuff[9] = (reference >>> 8) & 0xFF;
        txBuff[10] = (reference >>> 16) & 0xFF;
        txBuff[11] = (reference >>> 24) & 0xFF;
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_READ_ARRAY, txBuff);
        if(!(resp && resp.cmd === FlintDbgCmd.DBG_CMD_READ_ARRAY && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK))
            return undefined;
        const elementSize = FlintClientDebugger.getElementTypeSize(arrayType);
        const elementType = arrayType.substring(1);
        const actualLength = resp.data.length / elementSize;
        const ret: FlintVariableValue[] = [];
        if(elementSize === 1) {
            for(let i = 0; i < actualLength; i++) {
                const name = '[' + i + ']';
                const value = (resp.data[i] & 0x80) ? -(0x80 - (resp.data[i] & 0x7F)) : resp.data[i];
                ret.push(new FlintVariableValue(name, elementType, value, elementSize));
            }
            return ret;
        }
        else if(elementSize === 2) {
            let index = 0;
            for(let i = 0; i < actualLength; i++) {
                const name = '[' + i + ']';
                let value = FlintClientDebugger.readU16(resp.data, index);
                value = (elementType === 'C') ? -(0x8000 - (value & 0x7FFF)) : value;
                ret.push(new FlintVariableValue(name, elementType, value, elementSize));
            }
            return ret;
        }
        else if(elementSize === 4) {
            let index = 0;
            if(FlintClientDebugger.isPrimType(elementType)) {
                for(let i = 0; i < actualLength; i++) {
                    const name = '[' + i + ']';
                    let value: number | bigint = FlintClientDebugger.readU32(resp.data, index);
                    index += 4;
                    ret.push(new FlintVariableValue(name, elementType, value, elementSize));
                }
                return ret;
            }
            else {
                for(let i = 0; i < actualLength; i++) {
                    const reference = FlintClientDebugger.readU32(resp.data, index);
                    index += 4;
                    const name = '[' + i + ']';
                    if(reference !== 0) {
                        const sizeAndType = await this.readSizeAndTypeRequest(reference);
                        if(sizeAndType === undefined)
                            return undefined;
                        const size = sizeAndType[0];
                        const type = sizeAndType[1];
                        const item = new FlintVariableValue(name, type, reference, size);
                        this.addToRefMap(item);
                        ret.push(item);
                    }
                    else
                        ret.push(new FlintVariableValue(name, arrayType.substring(1), reference, 4));
                }
                return ret;
            }
        }
        else if(elementSize === 8) {
            let index = 0;
            for(let i = 0; i < actualLength; i++) {
                const name = '[' + i + ']';
                let value: number | bigint  = FlintClientDebugger.readU64(resp.data, index);
                index += 8;
                ret.push(new FlintVariableValue(name, elementType, value, elementSize));
            }
            return ret;
        }
    }

    private async readVariableRequest(reference: number): Promise<FlintVariableValue[] | undefined> {
        if(!this.variableReferenceMap.has(reference))
            return undefined;
        const valueInfo = this.variableReferenceMap.get(reference);
        if(valueInfo === undefined)
            return undefined;
        if(FlintClientDebugger.isPrimType(valueInfo.type))
            return undefined;
        if(valueInfo.variable === undefined) {
            if(!FlintClientDebugger.isArrayType(valueInfo.type)) {
                const clsName = FlintClientDebugger.getSimpleNames(valueInfo.type)[0];
                const clsLoader = FlintClassLoader.load(clsName);
                const fieldInfos = clsLoader.getFieldList(true);
                if(!fieldInfos)
                    return undefined;
                const filedValues: FlintVariableValue[] = [];
                for(let i = 0; i < fieldInfos.length; i++) {
                    if(fieldInfos[i].accessFlag & FlintFieldInfo.FIELD_STATIC)
                        continue;
                    const result = await this.readFieldRequest(reference, fieldInfos[i]);
                    if(result === undefined) {
                        const name = fieldInfos[i].name;
                        const descriptor = fieldInfos[i].descriptor;
                        filedValues.push(new FlintVariableValue(name, descriptor, undefined, 0));
                    }
                    else
                        filedValues.push(result);
                }
                valueInfo.variable = filedValues;
            }
            else {
                const length = valueInfo.size / FlintClientDebugger.getElementTypeSize(valueInfo.type);
                const result = await this.readArrayRequest(reference, 0, length, valueInfo.type);
                if(result === undefined)
                    return undefined;
                valueInfo.variable = result;
            }
        }
        return valueInfo.variable;
    }

    private async readSizeAndTypeRequest(reference: number): Promise<[number, string] | undefined> {
        const txBuff = Buffer.alloc(4);
        txBuff[0] = (reference >>> 0) & 0xFF;
        txBuff[1] = (reference >>> 8) & 0xFF;
        txBuff[2] = (reference >>> 16) & 0xFF;
        txBuff[3] = (reference >>> 24) & 0xFF;
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_READ_SIZE_AND_TYPE, txBuff);
        if(!(resp && resp.cmd === FlintDbgCmd.DBG_CMD_READ_SIZE_AND_TYPE && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK))
            return undefined;
        const size = FlintClientDebugger.readU32(resp.data, 0);
        const typeLength = FlintClientDebugger.readU16(resp.data, 4);
        const typeName = resp.data.toString('utf-8', 8, 8 + typeLength);
        return [size, typeName];
    }

    private async readStringValue(strReference: number, isStringBuilder: boolean): Promise<string | undefined> {
        const strValueInfo = this.variableReferenceMap.get(strReference) as FlintVariableValue;
        const fields = (strValueInfo.variable !== undefined) ? strValueInfo.variable : await this.readVariableRequest(strReference);
        const coder = fields?.find((variable) => variable.name === 'coder');
        const value = fields?.find((variable) => variable.name === 'value');
        if(coder === undefined || value === undefined)
            return undefined;
        const array = value.value ? await this.readArrayRequest(value.value as number, 0, value.size, value.type) : undefined;
        if(array === undefined)
            return undefined;
        let count: number | undefined;
        if(isStringBuilder) {
            const tmp = await this.readFieldRequest(strReference, new FlintFieldInfo('count', 'I', 0));
            if(tmp == undefined)
                return undefined;
            count = (tmp.value as number) << (coder.value as number);
        }
        else
            count = array.length;
        if(count === undefined)
            return undefined;
        const byteArray: number[] = [];
        if(coder.value === 0) {
            for(let i = 0; i < count; i++)
                byteArray.push((array[i].value as number) & 0xFF);
        }
        else for(let i = 0; i < count; i += 2) {
            const low = (array[i + 0].value as number) & 0xFF;
            const hight = (array[i + 1].value as number) & 0xFF;
            byteArray.push(low | (hight << 8));
        }
        return String.fromCharCode(...byteArray);
    }

    private async checkAndReadString(reference: number, typeName: string): Promise<string | undefined> {
        if(reference && !FlintClientDebugger.isPrimType(typeName) && !FlintClientDebugger.isArrayType(typeName)) {
            const className = FlintClientDebugger.getSimpleNames(typeName)[0];
            const classLoader = FlintClassLoader.load(className);
            let str: string | undefined = undefined;
            if(classLoader.isClassOf('java/lang/String'))
                str = await this.readStringValue(reference, false);
            else if(classLoader.isClassOf('java/lang/AbstractStringBuilder'))
                str = await this.readStringValue(reference, true);
            if(str != undefined) {
                let value = str.replace(/\"/g, '\\\"');
                value = str.replace(/\\/g, '\\\\');
                value = '\"' + value + '\"';
                return value;
            }
            else
                return undefined;
        }
        return undefined;
    }

    private async openFile(fileName: string, mode: FlintFileMode, timeout: number): Promise<boolean> {
        fileName = fileName.replace(/\\/g, '/');
        const txBuff = Buffer.alloc(6 + fileName.length);
        txBuff[0] = mode;
        FlintClientDebugger.putConstUtf8ToBuffer(txBuff, fileName, 1);
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_OPEN_FILE, txBuff, timeout);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_OPEN_FILE && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    private async writeFile(data: Buffer, offset: number, length: number, timeout: number): Promise<boolean> {
        const ret = Buffer.alloc(length);
        data.copy(ret, 0, offset, offset + length);
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_WRITE_FILE, ret, timeout);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_WRITE_FILE && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    private async closeFile(timeout: number): Promise<boolean> {
        const resp = await this.sendCmd(FlintDbgCmd.DBG_CMD_CLOSE_FILE, undefined, timeout);
        if(resp && resp.cmd === FlintDbgCmd.DBG_CMD_CLOSE_FILE && resp.responseCode === FlintDbgRespCode.DBG_RESP_OK)
            return true;
        else
            return false;
    }

    public async installFile(filePath: string, fileName: string, progressChanged?: (progress: number, total: number) => void): Promise<boolean> {
        try {
            const data = fs.readFileSync(filePath, undefined);
            const startResult = await this.openFile(fileName, FlintFileMode.FILE_CREATE_ALWAYS, 2000);
            if(!startResult)
                return false;
            let offset = 0;
            const blockSize = 512;
            let remainingSize = data.length - offset;
            while(remainingSize) {
                const length = (blockSize < remainingSize) ? blockSize : remainingSize;
                const writeResult = await this.writeFile(data, offset, length, 2000);
                if(!writeResult)
                    return false;
                offset += length;
                if(progressChanged)
                    progressChanged(offset, data.length);
                remainingSize = data.length - offset;
            }
            const complateResult = await this.closeFile(2000);
            if(complateResult) {
                if(progressChanged)
                    progressChanged(data.length, data.length);
                return true;
            }
            else
                return false;
        }
        catch {
            return false;
        }
    }

    public disconnect() {
        this.currentStackFrames = undefined;
        this.currentStatus = FlintClientDebugger.DBG_STATUS_STOP;
        if(this.requestConsoleTask) {
            clearTimeout(this.requestConsoleTask);
            this.requestConsoleTask = undefined;
        }
        if(this.requestStatusTask) {
            clearTimeout(this.requestStatusTask);
            this.requestStatusTask = undefined;
        }
        this.client.disconnect();
    }

    private static readU16(data: Buffer, offset : number): number {
        let ret = data[offset];
        ret |= data[offset + 1] << 8;
        return ret;
    }

    private static readU32(data: Buffer, offset : number): number {
        let ret = data[offset];
        ret |= data[offset + 1] << 8;
        ret |= data[offset + 2] << 16;
        ret |= data[offset + 3] << 24;
        return ret >>> 0;
    }

    private static readU64(data: Buffer, offset : number): bigint {
        let ret = BigInt(data[offset]);
        ret |= BigInt(data[offset + 1]) << 8n;
        ret |= BigInt(data[offset + 2]) << 16n;
        ret |= BigInt(data[offset + 3]) << 24n;
        ret |= BigInt(data[offset + 4]) << 32n;
        ret |= BigInt(data[offset + 5]) << 40n;
        ret |= BigInt(data[offset + 6]) << 48n;
        ret |= BigInt(data[offset + 7]) << 56n;
        return ret;
    }
}
