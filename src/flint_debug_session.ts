
import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
    ProgressStartEvent, ProgressUpdateEvent, ProgressEndEvent, InvalidatedEvent,
    Thread, StackFrame, Scope, Source, Handles, Breakpoint, MemoryEvent,
    Variable
} from '@vscode/debugadapter';
import * as fs from 'fs';
import path = require('path');
import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import { DebugProtocol } from '@vscode/debugprotocol';
import { FlintClientDebugger } from './flint_client_debugger';
import { FlintClassLoader } from './class_loader/flint_class_loader';
import { FlintClient } from './flint_client';
import { FlintTcpClient } from './flint_tcp_client';
import { FlintUartClient } from './flint_uart_client';
import { PolishNotation } from './polish_notation';
import { setWorkspace, resolvePath } from './flint_common';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    cwd?: string;
    install?: boolean;
    mainClass: string;
    classPath?: string | string[];
    sourcePath?: string | string[];
    modulePath?: string | string[];
    port?: string;
}

export class FlintDebugSession extends LoggingDebugSession {
    private flint?: ChildProcess;
    private mainClass?: string;
    private clientDebugger?: FlintClientDebugger;

    public constructor() {
        super('flint-debug.txt');
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments) {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        response.body.supportsStepInTargetsRequest = true;
        response.body.supportsSteppingGranularity = true;
        response.body.supportsDataBreakpoints = true;
        response.body.supportsCompletionsRequest = true;
        response.body.supportsCancelRequest = true;
        response.body.supportsBreakpointLocationsRequest = true;
        response.body.supportsExceptionFilterOptions = true;
        response.body.supportsExceptionInfoRequest = true;
        response.body.supportsSetVariable = true;
        response.body.supportsSetExpression = true;
        response.body.supportsDisassembleRequest = true;
        response.body.supportsInstructionBreakpoints = true;
        response.body.supportsReadMemoryRequest = false;
        response.body.supportsWriteMemoryRequest = false;
        response.body.supportSuspendDebuggee = true;
        response.body.supportTerminateDebuggee = true;
        response.body.supportsFunctionBreakpoints = true;
        response.body.supportsDelayedStackTraceLoading = false;
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsLogPoints = true;
        response.body.supportsRestartRequest = true;
        response.body.supportsTerminateRequest = true;
        response.body.supportsGotoTargetsRequest = false;

        response.body.exceptionBreakpointFilters = [{filter: 'all', label: 'Caught Exceptions', default: false}];

        this.sendResponse(response);
    }

    private initClient(client: FlintClient) {
        this.clientDebugger = new FlintClientDebugger(client);

        this.clientDebugger?.on('stop', (reason?: string) => {
            if(reason === 'done') {
                this.clientDebugger?.removeAllListeners();
                this.sendEvent(new TerminatedEvent());
            }
            if(reason === 'exception')
                this.sendEvent(new StoppedEvent(reason, 1));
            else
                this.sendEvent(new StoppedEvent('stop', 1));
        });

        this.clientDebugger?.on('stdout', (data: string) => {
            this.sendEvent(new OutputEvent(data, 'console'));
        });

        this.clientDebugger?.on('error', () => {

        });

        this.clientDebugger?.on('close', () => {
            vscode.window.showErrorMessage('FlintJVM Server has been closed');
            this.sendEvent(new TerminatedEvent());
        });
    }

    private getFlintClient(port?: string): FlintClient | undefined {
        try {
            if(port) {
                port = port.replace(/\s/g, '');
                const tcpRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:(\d{1,5}))*$/;
                if(tcpRegex.test(port)) {
                    const match = port.match(tcpRegex) as RegExpExecArray;
                    const ip = match[1];
                    const portNum = match[3] ? Number(match[3]) : 9620;
                    return new FlintTcpClient(portNum, ip);
                }
                else {
                    const comRegex = /^([^@]+)(@(\d+))*/;
                    const match = port.match(comRegex) as RegExpExecArray;
                    const comName = match[1];
                    const baudrate = match[3] ? Number(match[3]) : 460800;
                    return new FlintUartClient(comName, baudrate);
                }
            }
            return new FlintTcpClient(9620, '127.0.0.1');
        }
        catch(exception: any) {
            return undefined;
        }
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments, request?: DebugProtocol.Request) {
        this.mainClass = args.mainClass;
        FlintClassLoader.freeAll();
        if(args.cwd) setWorkspace(args.cwd);
        const classPath = (typeof args.classPath == "string") ? [args.classPath] : args.classPath;
        const sourcePath = (typeof args.sourcePath == "string") ? [args.sourcePath] : args.sourcePath;
        const modulePath = (typeof args.modulePath == "string") ? [args.modulePath] : args.modulePath;
        if(classPath) FlintClassLoader.setClassPath(classPath);
        if(sourcePath) FlintClassLoader.setSourcePath(sourcePath);
        if(modulePath) FlintClassLoader.setModulePath(modulePath);
        const flintClient = this.getFlintClient(args.port);
        if(!flintClient)
            return this.sendErrorResponse(response, 1, 'Invalid port parameter');
        this.initClient(flintClient);
        if(!await this.clientDebugger?.connect())
            return this.sendErrorResponse(response, 1, 'could not connect to ' + flintClient.toString());
        await this.clientDebugger?.enterDebugModeRequest();
        const terminateRet = await this.clientDebugger?.terminateRequest(false, 2000);
        if(!terminateRet)
            return this.sendErrorResponse(response, 1, 'could not terminate current process');
        if(args.install && classPath) {
            for(let i = 0; i < classPath.length; i++) {
                const p = resolvePath(classPath[i]);
                if(!p) continue;
                const files = await this.getAllClassFiles(p);
                for(let j = 0; j < files.length; j++) {
                    let name = path.relative(p, files[j]);
                    if(!(await this.installFile(files[j], name)))
                        return this.sendErrorResponse(response, 1, 'could install file ' + name.replace(/\\/g, '/'));
                }
            }
        }
        const rmBkpRet = await this.clientDebugger?.removeAllBreakPoints();
        if(rmBkpRet) {
            this.sendResponse(response);
            this.sendEvent(new InitializedEvent());
        }
        else
            this.sendErrorResponse(response, 1, 'could not remove all breakpoint');
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        this.sendResponse(response);
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments, request?: DebugProtocol.Request) {
        const value = await this.clientDebugger?.terminateRequest(true);
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'could not terminate');
        this.clientDebugger?.removeAllListeners();
        this.sendEvent(new TerminatedEvent());
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request) {
        this.clientDebugger?.disconnect();
        this.killFlint();
        this.sendResponse(response);
    }

    protected async configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments, request?: DebugProtocol.Request | undefined) {
        if(!this.mainClass)
            this.sendErrorResponse(response, 1, 'Could not start. There is no information about the main class');
        else {
            const value = await this.clientDebugger?.restartRequest(this.mainClass);
            if(value) {
                this.clientDebugger?.startCheckStatus();
                this.sendResponse(response);
            }
            else
                this.sendErrorResponse(response, 1, 'Could not start to main class "' + this.mainClass + '"');
        }
    }

    protected async setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments, request?: DebugProtocol.Request) {
        let isEnabled: boolean = false;
        if(args.filterOptions && args.filterOptions.length > 0 && args.filterOptions[0].filterId === 'all')
            isEnabled = true;
        const value = await this.clientDebugger?.setExceptionBreakPointsRequest(isEnabled);
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'An error occurred while ' + isEnabled ? 'enabling' : 'disabling' + ' Caught Exceptions');
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request) {
        if(args.lines && args.source.path) {
            try {
                const bkps = await this.clientDebugger?.setBreakPointsRequest(args.lines, args.source.path);
                response.body = {
                    breakpoints: bkps as Breakpoint[]
                };
                this.sendResponse(response);
            }
            catch(exception: any) {
                this.sendErrorResponse(response, 1, exception);
            }
        }
        else
            this.sendResponse(response);
    }

    protected async setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments, request?: DebugProtocol.Request) {
        this.sendResponse(response);
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request | undefined) {
        const value = await this.clientDebugger?.stopRequest();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'could not pause');
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
        const value = await this.clientDebugger?.runRequest();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'could not continue');
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        const value = await this.clientDebugger?.stepOverRequest();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'could not next');
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.Request | undefined) {
        const value = await this.clientDebugger?.stepInRequest();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'could not step in');
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request | undefined) {
        const value = await this.clientDebugger?.stepOutRequest();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'could not step over');
    }

    protected async restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments, request?: DebugProtocol.Request | undefined) {
        if(!this.mainClass)
            this.sendErrorResponse(response, 1, 'Could not restart. There is no information about the main class');
        else {
            const value = await this.clientDebugger?.restartRequest(this.mainClass);
            if(value)
                this.sendResponse(response);
            else
                this.sendErrorResponse(response, 1, 'could not restart');
        }
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request) {
        const scopes: DebugProtocol.Scope[] = [
            new Scope("Locals", 0x100000000 + args.frameId, true),
            new Scope("Globals", 0x200000000, true),
        ];
        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {
        try {
            const variableType: bigint = BigInt(args.variablesReference) >> 32n;
            if(variableType === 1n) {
                const frameId = args.variablesReference & 0xFFFFFFFF;
                const result = await this.clientDebugger?.readLocalVariables(frameId);
                if(result)
                    response.body = {variables: result};
                this.sendResponse(response);
            }
            else if(variableType === 2n)
                this.sendResponse(response);
            else {
                const result = await this.clientDebugger?.readVariable(args.variablesReference);
                if(result)
                    response.body = {variables: result};
                this.sendResponse(response);
            }
        }
        catch(exception: any) {
            this.sendErrorResponse(response, 1, exception);
        }
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        const frameId = (args.frameId !== undefined) ? args.frameId : 0;
        const ret = await PolishNotation.evaluate(args.expression, this.clientDebugger as FlintClientDebugger, frameId);
        response.body = {
            result: ret.value,
            variablesReference: ret.variablesReference
        };
        this.sendResponse(response);
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
        const start = (args.startFrame !== null) ? args.startFrame : 0;
        const level = ((args.startFrame !== null) && (args.levels !== null)) ? args.levels : 1;
        if(start !== 0) {
            this.sendResponse(response);
            return;
        }
        try {
            const frames = await this.clientDebugger?.stackFrameRequest();
            if(frames) {
                response.body = {
                    stackFrames: frames,
                    totalFrames: frames.length,
                };
                this.sendResponse(response);
            }
            else
                this.sendErrorResponse(response, 1, 'could not read stack frame');
        }
        catch(exception: any) {
            this.sendErrorResponse(response, 1, exception);
        }
    }

    protected async sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments, request?: DebugProtocol.Request) {
        try {
            const srcName = args.source?.name as string;
            const lastDotIndex = srcName.lastIndexOf('.');
            const clsName = lastDotIndex !== -1 ? srcName.substring(0, lastDotIndex) : srcName;
            const content = FlintClassLoader.load(clsName).getSource();
            if(content) {
                response.body = {
                    content: content,
                    mimeType: 'text/x-java'
                };
                this.sendResponse(response);
            }
            else
                this.sendErrorResponse(response, 1, '');
        }
        catch(exception: any) {
            this.sendErrorResponse(response, 1, exception);
        }
    }

    protected async exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments) {
        const excpInfo = await this.clientDebugger?.readExceptionInfo();
        if(excpInfo) {
            const typeName = excpInfo.type.replace(/\//g, '.');
            response.body = {
                exceptionId: typeName,
                description: excpInfo.message,
                breakMode: 'always',
                details: {
                    message: excpInfo.message,
                    typeName: typeName,
                }
            };
            this.sendResponse(response);
        }
        else
            this.sendErrorResponse(response, 1, 'could not read exception information');
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse) {
        response.body = {
            threads: [
                new Thread(1, 'thread 1'),
            ]
        };
        this.sendResponse(response);
    }

    private async installFile(filePath: string, fileName: string): Promise<boolean> {
        return new Promise((resolve) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: "Processing",
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    console.log("User canceled the long running operation");
                    resolve(false);
                    return;
                });
                progress.report({increment: 0, message: fileName + ': ' + '0% completed'});
                let oldPercent = 0;
                const progressChanged = (process: number, total: number) => {
                    const percent = process * 100 / total;
                    const increment = percent - oldPercent;
                    oldPercent = percent;
                    const msg = fileName.replace(/\\/g, '/') + ': ' + (percent === 100 ? '100' : percent.toFixed(0)) + '% completed';
                    progress.report({increment: increment, message: msg});
                }
                const result = await this.clientDebugger?.installFile(filePath, fileName, progressChanged);
                resolve(result ? true : false);
            });
        });
    }

    private async getAllClassFiles(directoryPath: string): Promise<string[]> {
        const tmp = fs.readdirSync(directoryPath, { withFileTypes: true });
        const files: string[] = [];
        if(tmp && tmp.length > 0) {
            for(let i = 0; i < tmp.length; i++) {
                if(tmp[i].isFile()) {
                    if(path.extname(tmp[i].name).toLowerCase() === '.class')
                        files.push(path.join(tmp[i].parentPath, tmp[i].name));
                }
                else {
                    const ret = await this.getAllClassFiles(path.join(tmp[i].parentPath, tmp[i].name));
                    if(ret && ret.length > 0) {
                        for(let j = 0; j < ret.length; j++)
                            files.push(ret[j]);
                    }
                }
            }
        }
        return files;
    }

    private killFlint() {
        if(this.flint) {
            this.flint.stdout?.removeAllListeners();
            this.flint.removeAllListeners();
            this.flint.kill();
            this.flint = undefined;
        }
    }
}
