import { Variable } from "@vscode/debugadapter";
import { FlintClientDebugger } from "./flint_client_debugger";

export class PolishNotation {
    private static parse(expression: string): string[] {
        const operators = '&|^+-*/%><!~=';
        const brackets = '[]()';
        const ret: string[] = [];
        let typeOld = 0;
        let startIndex = 0;
        for(let i = 0; i < expression.length; i++) {
            const ch = expression.charAt(i);
            let type;
            if(ch === '.') {
                const tmp = (startIndex < i) ? expression.substring(startIndex, i).trim() : '';
                type = Number.isInteger(Number(tmp)) ? 0 : 1;
            }
            else
                type = (operators.indexOf(ch) >= 0) ? 1 : ((brackets.indexOf(ch) >= 0) ? 2 : 0);
            if((typeOld != type) || (type === 2)) {
                if(startIndex < i) {
                    const tmp = expression.substring(startIndex, i).trim();
                    if(tmp.length > 0)
                        ret.push(tmp);
                    startIndex = i;
                }
                typeOld = type;
            }
        }
        if(startIndex < expression.length) {
            const tmp = expression.substring(startIndex, expression.length).trim();
            if(tmp.length > 0)
                ret.push(tmp);
        }
        return ret;
    }

    private static getOperatorPrecedence(operator: string) {
        const operators = [
            ['.'],
            ['!', '~'],
            ['['],
            ['*', '/', '%'],
            ['+', '-'],
            ['<<', '>>', '>>>'],
            ['<', '<=', '>', '>='],
            ['==', '!='],
            ['&'],
            ['^'],
            ['|'],
            ['&&'],
            ['||'], 
        ];
        for(let i = 0; i < operators.length; i++) {
            if(operators[i].indexOf(operator) >= 0)
                return operators.length - i;
        }
        return 0;
    }

    private static postfix(expression: string): string[] {
        const tokens = PolishNotation.parse(expression);
        const p: string[] = [];
        const s: string[] = [];
        while(tokens.length > 0) {
            const token = tokens.shift() as string;
            if(token === '(')
                s.push('(');
            else if((token === ')') || (token === ']')) {
                while(s.length > 0) {
                    const tmp = s.pop() as string;
                    if(tmp === '(')
                        break;
                    p.push(tmp);
                }
            }
            else {
                const operator = PolishNotation.getOperatorPrecedence(token);
                if(operator === 0)
                    p.push(token);
                else {
                    if(s.length > 0) {
                        let preOperator = PolishNotation.getOperatorPrecedence(s[s.length - 1]);
                        while((preOperator > 0) && (preOperator > operator)) {
                            p.push(s.pop() as string);
                            if(s.length > 0)
                                preOperator = PolishNotation.getOperatorPrecedence(s[s.length - 1]);
                            else
                                break;
                        }
                    }
                    s.push(token);
                    if(token === '[')
                        s.push('(');
                }
            }
        }
        while(s.length > 0)
            p.push(s.pop() as string);
        return p;
    }

    private static isConst(value: string) {
        if(value === 'false')
            return true;
        else if(value === 'true')
            return true;
        return !isNaN(parseFloat(value)) && isFinite(Number(value));
    }

    private static convertToConstValue(value: string): number | bigint | boolean {
        if(value === 'false')
            return false;
        else if(value === 'true')
            return true;
        return +value;
    }

    private static async loadValue(value: any, clientDebugger: FlintClientDebugger): Promise<number | boolean> {
        if(typeof value === 'boolean')
            return value;
        if(typeof value === 'number')
            return (value as number);
        else if(typeof value === 'string') {
            const fields = await clientDebugger.readLocalVariables(0);
            return Number((fields?.find((variable) => variable.name === value) as Variable).value);
        }
        else
            return Number((value as Variable).value);
    }

    public static async evaluate(expression: string, clientDebugger: FlintClientDebugger): Promise<Variable> {
        try {
            const postfix = PolishNotation.postfix(expression);
            const stack: (Variable | number | bigint | boolean | string)[] = [];
            while(postfix.length > 0) {
                const token = postfix.shift() as string;
                switch(token) {
                    case '.': {
                        const fileName = stack.pop() as string;
                        const instance = stack.pop() as Variable;
                        stack.push((await clientDebugger.readField(instance.variablesReference, fileName)) as Variable);
                        break;
                    }
                    case '[': {
                        const index = await this.loadValue(stack.pop(), clientDebugger);
                        const instance = stack.pop() as Variable;
                        const fileName = '[' + index + ']';
                        stack.push((await clientDebugger.readField(instance.variablesReference, fileName)) as Variable);
                        break;
                    }
                    case '&&': {
                        const b = await this.loadValue(stack.pop(), clientDebugger);
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        stack.push(a && b);
                        break;
                    }
                    case '||': {
                        const b = await this.loadValue(stack.pop(), clientDebugger);
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        stack.push(a || b);
                        break;
                    }
                    case '&': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        stack.push(a & b);
                        break;
                    }
                    case '|': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        stack.push(a | b);
                        break;
                    }
                    case '^': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        stack.push(a ^ b);
                        break;
                    }
                    case '==': {
                        const b = await this.loadValue(stack.pop(), clientDebugger);
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        if(
                            (typeof a === 'number') && (typeof b === 'number') ||
                            (typeof a === 'boolean') && (typeof b === 'boolean')
                        ) {
                            stack.push(a == b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '!=': {
                        const b = await this.loadValue(stack.pop(), clientDebugger);
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        if(
                            (typeof a === 'number') && (typeof b === 'number') ||
                            (typeof a === 'boolean') && (typeof b === 'boolean')
                        ) {
                            stack.push(a != b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '<': {
                        const b = await this.loadValue(stack.pop(), clientDebugger);
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a < b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '>': {
                        const b = await this.loadValue(stack.pop(), clientDebugger);
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a > b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '<=': {
                        const b = await this.loadValue(stack.pop(), clientDebugger);
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a <= b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '>=': {
                        const b = await this.loadValue(stack.pop(), clientDebugger);
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a >= b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '<<': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a << b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '>>': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a >> b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '>>>': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a >>> b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '+': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a + b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '-': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a - b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '*': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a * b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '/': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            const ret = a / b;
                            if(Number.isInteger(a) && Number.isInteger(b))
                                stack.push(Math.floor(ret));
                            else
                                stack.push(ret);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '%': {
                        const b = await this.loadValue(stack.pop(), clientDebugger) as number;
                        const a = await this.loadValue(stack.pop(), clientDebugger) as number;
                        if((typeof a === 'number') && (typeof b === 'number')) {
                            stack.push(a % b);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '!': {
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        if(typeof a === 'boolean') {
                            stack.push(!a);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    case '~': {
                        const a = await this.loadValue(stack.pop(), clientDebugger);
                        if(typeof a === 'number') {
                            stack.push(~a);
                            break;
                        }
                        else
                            throw 'Invalid expression';
                    }
                    default: {
                        if(PolishNotation.isConst(token))
                            stack.push(PolishNotation.convertToConstValue(token));
                        else {
                            if(stack.length === 0) {
                                const fields = await clientDebugger.readLocalVariables(0);
                                stack.push(fields?.find((variable) => variable.name === token) as Variable);
                            }
                            else
                                stack.push(token);
                        }
                        break;
                    }  
                }
            }
            const value = stack.pop();
            let ret;            
            if((typeof value === 'number') || (typeof value === 'bigint') || (typeof value === 'boolean'))
                ret = new Variable(expression, value.toString(), 0);
            else if(typeof value === 'object')
                ret = value;
            else if(typeof value === 'string') {
                const fields = await clientDebugger.readLocalVariables(0);
                ret = fields?.find((variable) => variable.name === value);
            }
            return (ret !== undefined) ? ret : new Variable(expression, 'not available', 0);
        }
        catch {
            return new Variable(expression, 'not available', 0);
        }
    }
}
