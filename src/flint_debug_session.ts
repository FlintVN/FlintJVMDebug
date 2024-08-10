
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

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    launchFlintJVMServerCommand?: string;
    install?: boolean;
    mainClass: string;
    classPath?: string;
    sourcePath?: string;
    jdkClassPath?: string;
    jdkSourcePath?: string;
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
            if(reason)
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

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments, request?: DebugProtocol.Request) {
        this.mainClass = args.mainClass;
        FlintClassLoader.freeAll();
        FlintClassLoader.setClassPath(args.classPath);
        FlintClassLoader.setSourcePath(args.sourcePath);
        FlintClassLoader.setJdkClassPath(args.jdkClassPath);
        FlintClassLoader.setJdkSourcePath(args.jdkSourcePath);
        let launchServerCmd = args.launchFlintJVMServerCommand;
        if(launchServerCmd !== undefined) {
            launchServerCmd = launchServerCmd.trim();
            if(launchServerCmd != '') {
                if(!await this.startFlintJVMServer(launchServerCmd)) {
                    this.sendErrorResponse(response, 1, 'Cound start FlintJVMServer by command ' + launchServerCmd);
                    return;
                }
            }
        }
        const tcpClient = new FlintTcpClient(5555, '127.0.0.1');
        this.initClient(tcpClient);
        await this.clientDebugger?.connect();
        const terminateRet = await this.clientDebugger?.terminateRequest(false);
        if(!terminateRet) {
            this.sendErrorResponse(response, 1, 'Cound terminate current process');
            return;
        }
        if(args.install) {
            const workspace = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
            const classPath = FlintClassLoader.getClassPath();
            const folder = classPath ? classPath : workspace;
            const filesPath = await this.getAllClassFiles(folder);
            for(let i = 0; i < filesPath.length; i++) {
                let name = filesPath[i].substring(folder.length);
                while(name.charAt(0) === '\\')
                    name = name.substring(1);
                if(!(await this.installFile(filesPath[i], name))) {
                    this.sendErrorResponse(response, 1, 'Cound install file ' + name);
                    return;
                }
            }
        }
        const rmBkpRet = await this.clientDebugger?.removeAllBreakPoints();
        if(rmBkpRet) {
            this.sendResponse(response);
            this.sendEvent(new InitializedEvent());
        }
        else
            this.sendErrorResponse(response, 1, 'Cound not remove all breakpoint');
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        this.sendResponse(response);
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments, request?: DebugProtocol.Request) {
        const value = await this.clientDebugger?.terminateRequest(true);
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'Cound not terminate');
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
                this.sendErrorResponse(response, 1, 'Could not start to main class \"' + this.mainClass + '\"');
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
            const value = await this.clientDebugger?.setBreakPointsRequest(args.lines, args.source.path.toLocaleLowerCase());
            if(value)
                this.sendResponse(response);
            else
                this.sendErrorResponse(response, 1, 'An error occurred while setting breakpoint');
        }
        else
            this.sendResponse(response);
    }

    protected async setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments, request?: DebugProtocol.Request) {
        this.sendResponse(response);
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request | undefined) {
        const value = await this.clientDebugger?.stop();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'Cound not pause');
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
        const value = await this.clientDebugger?.run();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'Cound not continue');
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        const value = await this.clientDebugger?.stepOverRequest();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'Cound not next');
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.Request | undefined) {
        const value = await this.clientDebugger?.stepInRequest();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'Cound not step in');
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request | undefined) {
        const value = await this.clientDebugger?.stepOutRequest();
        if(value)
            this.sendResponse(response);
        else
            this.sendErrorResponse(response, 1, 'Cound not step over');
    }

    protected async restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments, request?: DebugProtocol.Request | undefined) {
        if(!this.mainClass)
            this.sendErrorResponse(response, 1, 'Could not restart. There is no information about the main class');
        else {
            const value = await this.clientDebugger?.restartRequest(this.mainClass);
            if(value)
                this.sendResponse(response);
            else
                this.sendErrorResponse(response, 1, 'Cound not restart');
        }
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request) {
        const scopes: DebugProtocol.Scope[] = [
            new Scope("Local", 0x100000000 + args.frameId, true),
            new Scope("Global", 0x200000000, true),
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
                this.sendErrorResponse(response, 1, 'Cound not read stack frame');
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
            this.sendErrorResponse(response, 1, 'Cound not read exception information');
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
                title: "Processing: ",
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    console.log("User canceled the long running operation");
                    resolve(false);
                    return;
                });
                progress.report({ increment: 0, message: fileName + ': ' + '0% completed'});
                let oldPercent = 0;
                const progressChanged = (process: number, total: number) => {
                    const percent = process * 100 / total;
                    const increment = percent - oldPercent;
                    oldPercent = percent;
                    const msg = fileName + ': ' + (percent === 100 ? '100' : percent.toFixed(0)) + '% completed';
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
                    if(path.extname(tmp[i].name).toLocaleLowerCase() === '.class')
                        files.push(path.join(tmp[i].path, tmp[i].name));
                }
                else {
                    const ret = await this.getAllClassFiles(path.join(tmp[i].path, tmp[i].name));
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

    private async startFlintJVMServer(launchServerCmd: string): Promise<boolean> {
        return new Promise((resolve) => {
            let workspace = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
            const classPath = FlintClassLoader.getClassPath();
            if(classPath !== undefined)
                workspace = classPath;
            else
                workspace = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
            const cmd = launchServerCmd.substring(0, launchServerCmd.indexOf(' '));
            let tmp = launchServerCmd.substring(cmd.length).trim();
            do {
                tmp = tmp.replace(/  /g, ' ');
            } while(tmp.indexOf('  ') > 0);
            const agrs = tmp.split(' ');
            this.flint = spawn(cmd, agrs, {
                cwd: workspace,
                stdio: ['inherit'],
                windowsHide: true,
                detached: true,
            });
            const timeoutTask = setTimeout(() => {
                this.killFlint();
                resolve(false);
            }, 2000);
            if(!this.flint.stdout) {
                clearTimeout(timeoutTask);
                this.killFlint();
                resolve(false);
                return;
            }
            this.flint.stdout.on('data', (data) => {
                const str = data.toString();
                this.sendEvent(new OutputEvent(str, 'console'));
                this.flint?.stdout?.removeAllListeners();
                this.flint?.removeAllListeners();
                this.flint?.stdout?.on('data', (data) => {});
                if(str.includes('FlintJVM debug server is started')) {
                    clearTimeout(timeoutTask);
                    resolve(true);
                }
                else
                    resolve(false);
            });
            this.flint.on('close', (code) => {
                clearTimeout(timeoutTask);
                this.killFlint();
                resolve(false);
            });
            this.flint.on('error', (err) => {
                clearTimeout(timeoutTask);
                this.sendEvent(new OutputEvent(err.message, 'stderr'));
                this.killFlint();
                resolve(false);
            });
        });
    }
}
