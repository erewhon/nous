/**
 * Formula evaluator for database computed columns.
 * Custom expression evaluator with zero external dependencies.
 */
import type { CellValue } from "../../types/database";

// ── Result type ──

export type FormulaResult =
  | { value: CellValue; error?: undefined }
  | { value?: undefined; error: string };

// ── Tokens ──

type TokenType =
  | "NUMBER"
  | "STRING"
  | "BOOLEAN"
  | "IDENTIFIER"
  | "OPERATOR"
  | "LPAREN"
  | "RPAREN"
  | "COMMA";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

// ── AST Nodes ──

type ASTNode =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "identifier"; name: string }
  | { type: "unary"; operator: string; operand: ASTNode }
  | { type: "binary"; operator: string; left: ASTNode; right: ASTNode }
  | { type: "call"; name: string; args: ASTNode[] };

// ── Tokenizer ──

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number
    if (/\d/.test(ch) || (ch === "." && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
      const start = i;
      while (i < expr.length && /[\d.]/.test(expr[i])) i++;
      tokens.push({ type: "NUMBER", value: expr.slice(start, i), pos: start });
      continue;
    }

    // String (double-quoted)
    if (ch === '"') {
      const start = i;
      i++;
      let str = "";
      while (i < expr.length && expr[i] !== '"') {
        if (expr[i] === "\\" && i + 1 < expr.length) {
          i++;
          str += expr[i];
        } else {
          str += expr[i];
        }
        i++;
      }
      if (i >= expr.length) throw new Error(`Unterminated string at position ${start}`);
      i++; // closing quote
      tokens.push({ type: "STRING", value: str, pos: start });
      continue;
    }

    // String (single-quoted)
    if (ch === "'") {
      const start = i;
      i++;
      let str = "";
      while (i < expr.length && expr[i] !== "'") {
        if (expr[i] === "\\" && i + 1 < expr.length) {
          i++;
          str += expr[i];
        } else {
          str += expr[i];
        }
        i++;
      }
      if (i >= expr.length) throw new Error(`Unterminated string at position ${start}`);
      i++;
      tokens.push({ type: "STRING", value: str, pos: start });
      continue;
    }

    // Backtick-quoted identifier (multi-word column name)
    if (ch === "`") {
      const start = i;
      i++;
      let name = "";
      while (i < expr.length && expr[i] !== "`") {
        name += expr[i];
        i++;
      }
      if (i >= expr.length) throw new Error(`Unterminated backtick identifier at position ${start}`);
      i++;
      tokens.push({ type: "IDENTIFIER", value: name, pos: start });
      continue;
    }

    // Parentheses
    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(", pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")", pos: i });
      i++;
      continue;
    }

    // Comma
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: ",", pos: i });
      i++;
      continue;
    }

    // Multi-char operators
    if (i + 1 < expr.length) {
      const two = expr.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
        tokens.push({ type: "OPERATOR", value: two, pos: i });
        i += 2;
        continue;
      }
    }

    // Single-char operators
    if (["+", "-", "*", "/", "%", "<", ">", "!"].includes(ch)) {
      tokens.push({ type: "OPERATOR", value: ch, pos: i });
      i++;
      continue;
    }

    // Identifiers (keywords and column names)
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) i++;
      const word = expr.slice(start, i);
      if (word === "true" || word === "false") {
        tokens.push({ type: "BOOLEAN", value: word, pos: start });
      } else if (word === "and") {
        tokens.push({ type: "OPERATOR", value: "&&", pos: start });
      } else if (word === "or") {
        tokens.push({ type: "OPERATOR", value: "||", pos: start });
      } else if (word === "not") {
        tokens.push({ type: "OPERATOR", value: "!", pos: start });
      } else {
        tokens.push({ type: "IDENTIFIER", value: word, pos: start });
      }
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  return tokens;
}

// ── Parser (recursive descent) ──

function parse(tokens: Token[]): ASTNode {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function advance(): Token {
    return tokens[pos++];
  }

  function expect(type: TokenType, value?: string): Token {
    const t = peek();
    if (!t) throw new Error(`Expected ${type} but reached end of expression`);
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${value ?? type} at position ${t.pos}, got '${t.value}'`);
    }
    return advance();
  }

  // or → and ("||" and)*
  function parseOr(): ASTNode {
    let left = parseAnd();
    while (peek()?.type === "OPERATOR" && peek()!.value === "||") {
      advance();
      const right = parseAnd();
      left = { type: "binary", operator: "||", left, right };
    }
    return left;
  }

  // and → equality ("&&" equality)*
  function parseAnd(): ASTNode {
    let left = parseEquality();
    while (peek()?.type === "OPERATOR" && peek()!.value === "&&") {
      advance();
      const right = parseEquality();
      left = { type: "binary", operator: "&&", left, right };
    }
    return left;
  }

  // equality → comparison (("==" | "!=") comparison)*
  function parseEquality(): ASTNode {
    let left = parseComparison();
    while (peek()?.type === "OPERATOR" && (peek()!.value === "==" || peek()!.value === "!=")) {
      const op = advance().value;
      const right = parseComparison();
      left = { type: "binary", operator: op, left, right };
    }
    return left;
  }

  // comparison → additive (("<" | ">" | "<=" | ">=") additive)*
  function parseComparison(): ASTNode {
    let left = parseAdditive();
    while (
      peek()?.type === "OPERATOR" &&
      ["<", ">", "<=", ">="].includes(peek()!.value)
    ) {
      const op = advance().value;
      const right = parseAdditive();
      left = { type: "binary", operator: op, left, right };
    }
    return left;
  }

  // additive → multiplicative (("+" | "-") multiplicative)*
  function parseAdditive(): ASTNode {
    let left = parseMultiplicative();
    while (peek()?.type === "OPERATOR" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = advance().value;
      const right = parseMultiplicative();
      left = { type: "binary", operator: op, left, right };
    }
    return left;
  }

  // multiplicative → unary (("*" | "/" | "%") unary)*
  function parseMultiplicative(): ASTNode {
    let left = parseUnary();
    while (
      peek()?.type === "OPERATOR" &&
      (peek()!.value === "*" || peek()!.value === "/" || peek()!.value === "%")
    ) {
      const op = advance().value;
      const right = parseUnary();
      left = { type: "binary", operator: op, left, right };
    }
    return left;
  }

  // unary → ("!" | "-") unary | primary
  function parseUnary(): ASTNode {
    if (peek()?.type === "OPERATOR" && (peek()!.value === "!" || peek()!.value === "-")) {
      const op = advance().value;
      const operand = parseUnary();
      return { type: "unary", operator: op, operand };
    }
    return parsePrimary();
  }

  // primary → NUMBER | STRING | BOOLEAN | IDENTIFIER ("(" args ")")? | "(" expr ")"
  function parsePrimary(): ASTNode {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");

    if (t.type === "NUMBER") {
      advance();
      return { type: "number", value: parseFloat(t.value) };
    }

    if (t.type === "STRING") {
      advance();
      return { type: "string", value: t.value };
    }

    if (t.type === "BOOLEAN") {
      advance();
      return { type: "boolean", value: t.value === "true" };
    }

    if (t.type === "IDENTIFIER") {
      advance();
      // Function call?
      if (peek()?.type === "LPAREN") {
        advance(); // consume (
        const args: ASTNode[] = [];
        if (peek()?.type !== "RPAREN") {
          args.push(parseOr());
          while (peek()?.type === "COMMA") {
            advance();
            args.push(parseOr());
          }
        }
        expect("RPAREN");
        return { type: "call", name: t.value, args };
      }
      // Column reference
      return { type: "identifier", name: t.value };
    }

    if (t.type === "LPAREN") {
      advance();
      const expr = parseOr();
      expect("RPAREN");
      return expr;
    }

    throw new Error(`Unexpected token '${t.value}' at position ${t.pos}`);
  }

  const ast = parseOr();
  if (pos < tokens.length) {
    const extra = tokens[pos];
    throw new Error(`Unexpected token '${extra.value}' at position ${extra.pos}`);
  }
  return ast;
}

// ── Evaluator ──

type EvalValue = string | number | boolean | null;

function toNumber(v: EvalValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function toBool(v: EvalValue): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  return true;
}

function toStr(v: EvalValue): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

// Built-in functions
const BUILTINS: Record<string, (args: EvalValue[]) => EvalValue> = {
  // Conditional
  if: (args) => {
    if (args.length < 2) throw new Error("if() requires at least 2 arguments");
    return toBool(args[0]) ? args[1] : (args[2] ?? null);
  },

  // String functions
  concat: (args) => args.map(toStr).join(""),
  length: (args) => {
    if (args.length < 1) throw new Error("length() requires 1 argument");
    const v = args[0];
    if (typeof v === "string") return v.length;
    if (v == null) return 0;
    return toStr(v).length;
  },
  lower: (args) => toStr(args[0]).toLowerCase(),
  upper: (args) => toStr(args[0]).toUpperCase(),
  contains: (args) => {
    if (args.length < 2) throw new Error("contains() requires 2 arguments");
    return toStr(args[0]).toLowerCase().includes(toStr(args[1]).toLowerCase());
  },
  replace: (args) => {
    if (args.length < 3) throw new Error("replace() requires 3 arguments");
    return toStr(args[0]).split(toStr(args[1])).join(toStr(args[2]));
  },
  trim: (args) => toStr(args[0]).trim(),

  // Math functions
  abs: (args) => Math.abs(toNumber(args[0])),
  round: (args) => {
    const n = toNumber(args[0]);
    const decimals = args.length >= 2 ? toNumber(args[1]) : 0;
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  },
  floor: (args) => Math.floor(toNumber(args[0])),
  ceil: (args) => Math.ceil(toNumber(args[0])),
  min: (args) => {
    if (args.length === 0) return null;
    return Math.min(...args.map(toNumber));
  },
  max: (args) => {
    if (args.length === 0) return null;
    return Math.max(...args.map(toNumber));
  },
  sqrt: (args) => Math.sqrt(toNumber(args[0])),
  pow: (args) => {
    if (args.length < 2) throw new Error("pow() requires 2 arguments");
    return Math.pow(toNumber(args[0]), toNumber(args[1]));
  },

  // Date functions
  now: () => new Date().toISOString().split("T")[0],
  dateAdd: (args) => {
    if (args.length < 3) throw new Error("dateAdd() requires 3 arguments: date, amount, unit");
    const date = new Date(toStr(args[0]));
    if (isNaN(date.getTime())) return null;
    const amount = toNumber(args[1]);
    const unit = toStr(args[2]).toLowerCase();
    if (unit === "days" || unit === "day") date.setDate(date.getDate() + amount);
    else if (unit === "months" || unit === "month") date.setMonth(date.getMonth() + amount);
    else if (unit === "years" || unit === "year") date.setFullYear(date.getFullYear() + amount);
    else throw new Error(`Unknown date unit: ${unit}`);
    return date.toISOString().split("T")[0];
  },
  dateDiff: (args) => {
    if (args.length < 2) throw new Error("dateDiff() requires at least 2 arguments");
    const d1 = new Date(toStr(args[0]));
    const d2 = new Date(toStr(args[1]));
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
    const unit = args.length >= 3 ? toStr(args[2]).toLowerCase() : "days";
    const diffMs = d2.getTime() - d1.getTime();
    if (unit === "days" || unit === "day") return Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (unit === "hours" || unit === "hour") return Math.round(diffMs / (1000 * 60 * 60));
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  },

  // Conversion functions
  toNumber: (args) => {
    const v = args[0];
    if (v == null) return 0;
    if (typeof v === "number") return v;
    const n = parseFloat(toStr(v));
    return isNaN(n) ? 0 : n;
  },
  toString: (args: EvalValue[]) => toStr(args[0]),
  empty: (args) => {
    const v = args[0];
    return v == null || v === "" || v === 0 || v === false;
  },
};

function evaluate(node: ASTNode, context: Record<string, EvalValue>): EvalValue {
  switch (node.type) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "boolean":
      return node.value;

    case "identifier": {
      if (node.name in context) return context[node.name];
      throw new Error(`Unknown column: ${node.name}`);
    }

    case "unary": {
      const val = evaluate(node.operand, context);
      if (node.operator === "!") return !toBool(val);
      if (node.operator === "-") return -toNumber(val);
      throw new Error(`Unknown unary operator: ${node.operator}`);
    }

    case "binary": {
      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);

      switch (node.operator) {
        case "+": {
          // String concatenation if either side is a string
          if (typeof left === "string" || typeof right === "string") {
            return toStr(left) + toStr(right);
          }
          return toNumber(left) + toNumber(right);
        }
        case "-": return toNumber(left) - toNumber(right);
        case "*": return toNumber(left) * toNumber(right);
        case "/": {
          const d = toNumber(right);
          if (d === 0) throw new Error("Division by zero");
          return toNumber(left) / d;
        }
        case "%": {
          const d = toNumber(right);
          if (d === 0) throw new Error("Division by zero");
          return toNumber(left) % d;
        }
        case "==": return left === right || toStr(left) === toStr(right);
        case "!=": return left !== right && toStr(left) !== toStr(right);
        case "<": return toNumber(left) < toNumber(right);
        case ">": return toNumber(left) > toNumber(right);
        case "<=": return toNumber(left) <= toNumber(right);
        case ">=": return toNumber(left) >= toNumber(right);
        case "&&": return toBool(left) && toBool(right);
        case "||": return toBool(left) || toBool(right);
        default:
          throw new Error(`Unknown operator: ${node.operator}`);
      }
    }

    case "call": {
      const fn = BUILTINS[node.name];
      if (!fn) throw new Error(`Unknown function: ${node.name}`);
      const args = node.args.map((a) => evaluate(a, context));
      return fn(args);
    }
  }
}

// ── Extract column references ──

function collectIdentifiers(node: ASTNode, names: Set<string>): void {
  switch (node.type) {
    case "identifier":
      names.add(node.name);
      break;
    case "unary":
      collectIdentifiers(node.operand, names);
      break;
    case "binary":
      collectIdentifiers(node.left, names);
      collectIdentifiers(node.right, names);
      break;
    case "call":
      for (const arg of node.args) collectIdentifiers(arg, names);
      break;
  }
}

/**
 * Extract column name references from a formula expression.
 * Excludes built-in function names.
 */
export function extractColumnReferences(expression: string): string[] {
  try {
    const tokens = tokenize(expression);
    const ast = parse(tokens);
    const names = new Set<string>();
    collectIdentifiers(ast, names);
    // Filter out built-in function names
    for (const fn of Object.keys(BUILTINS)) {
      names.delete(fn);
    }
    return [...names];
  } catch {
    return [];
  }
}

// ── Public API ──

/**
 * Evaluate a formula expression with the given context (column name → value).
 */
export function evaluateFormula(
  expression: string,
  context: Record<string, CellValue>
): FormulaResult {
  try {
    if (!expression.trim()) return { value: null };

    const tokens = tokenize(expression);
    const ast = parse(tokens);

    // Convert CellValue context to EvalValue (flatten arrays to comma-separated strings)
    const evalCtx: Record<string, EvalValue> = {};
    for (const [key, val] of Object.entries(context)) {
      if (Array.isArray(val)) {
        evalCtx[key] = val.join(", ");
      } else {
        evalCtx[key] = val;
      }
    }

    const result = evaluate(ast, evalCtx);

    // Convert back to CellValue
    return { value: result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Dependency graph + topological sort ──

/**
 * Topological sort of formula property IDs.
 * Returns sorted order, or throws with "Circular reference" if cycles exist.
 */
export function topologicalSortFormulas(
  formulaDeps: Map<string, string[]>
): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const sorted: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("Circular reference");
    visiting.add(id);
    for (const dep of formulaDeps.get(id) ?? []) {
      if (formulaDeps.has(dep)) visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const id of formulaDeps.keys()) {
    visit(id);
  }

  return sorted;
}
