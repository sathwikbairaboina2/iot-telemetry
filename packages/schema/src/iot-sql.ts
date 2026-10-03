/*
 * A small interpreter for the AWS IoT SQL WHERE subset used by the three topic rules. It is an approximation of the
 * documented operator tables (checked 2026-10-04), limited to what the rules need:
 *
 *   missing field            -> Undefined          JSON null -> null
 *   AND / OR                 both Boolean (or "true"/"false" strings) -> Boolean, anything else -> Undefined.
 *                            No short-circuit: `false AND Undefined` is Undefined.
 *   NOT                      Boolean (or "true"/"false" string) -> negation, else Undefined
 *   =                        Undefined operand -> Undefined; same-type values compare; mismatched types -> false
 *   <>                       Undefined operand -> Undefined; mismatched types -> true; else negated =
 *   > >= < <=                numbers, or strings that are plain decimals; anything else -> Undefined
 *   topic(n) / topic()       n-th segment (1-based) or the whole topic
 *   time_to_epoch(s, pat)    only the payload timestamp pattern; an unparsable s makes the call fail
 *   get_or_default(e, d)     d when e fails, is Undefined or null
 *
 * A WHERE clause matches only when it evaluates to Boolean true.
 */

export const UNDEFINED: unique symbol = Symbol('UNDEFINED');
export type SqlValue = number | string | boolean | null | SqlValue[] | { [k: string]: SqlValue } | typeof UNDEFINED;

export interface SqlContext { topic: string }

const SUPPORTED_PATTERN = "yyyy-MM-dd'T'HH:mm:ss.SSSX";
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}(:?\d{2})?)$/;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error('unterminated string');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num && (c !== '-' || /\d/.test(src[i + 1] ?? ''))) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(>=|<=|<>|=|>|<|\(|\)|,|\.)/.exec(src.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    throw new Error(`unexpected character ${c}`);
  }
  return out;
}

type Node =
  | { k: 'lit'; v: SqlValue }
  | { k: 'path'; parts: string[] }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'not'; e: Node };

class Parser {
  private pos = 0;
  constructor(private readonly toks: Token[]) {}
  private peek(): Token | undefined { return this.toks[this.pos]; }
  private isKw(kw: string): boolean {
    const t = this.peek();
    return t?.t === 'id' && t.v.toUpperCase() === kw;
  }
  private isOp(op: string): boolean {
    const t = this.peek();
    return t?.t === 'op' && t.v === op;
  }
  private expectOp(op: string): void {
    if (!this.isOp(op)) throw new Error(`expected ${op}`);
    this.pos++;
  }
  parse(): Node {
    const n = this.or();
    if (this.pos !== this.toks.length) throw new Error('trailing tokens');
    return n;
  }
  private or(): Node {
    let l = this.and();
    while (this.isKw('OR')) { this.pos++; l = { k: 'bin', op: 'OR', l, r: this.and() }; }
    return l;
  }
  private and(): Node {
    let l = this.not();
    while (this.isKw('AND')) { this.pos++; l = { k: 'bin', op: 'AND', l, r: this.not() }; }
    return l;
  }
  private not(): Node {
    if (this.isKw('NOT')) { this.pos++; return { k: 'not', e: this.not() }; }
    return this.cmp();
  }
  private cmp(): Node {
    const l = this.primary();
    const t = this.peek();
    if (t?.t === 'op' && ['=', '<>', '>=', '<=', '>', '<'].includes(t.v)) {
      this.pos++;
      return { k: 'bin', op: t.v, l, r: this.primary() };
    }
    return l;
  }
  private primary(): Node {
    const t = this.peek();
    if (!t) throw new Error('unexpected end');
    this.pos++;
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'op') {
      if (t.v === '(') { const e = this.or(); this.expectOp(')'); return e; }
      throw new Error(`unexpected ${t.v}`);
    }
    const lower = t.v.toLowerCase();
    if (lower === 'true') return { k: 'lit', v: true };
    if (lower === 'false') return { k: 'lit', v: false };
    if (this.isOp('(')) {
      this.pos++;
      const args: Node[] = [];
      if (!this.isOp(')')) {
        args.push(this.or());
        while (this.isOp(',')) { this.pos++; args.push(this.or()); }
      }
      this.expectOp(')');
      return { k: 'call', name: t.v.toLowerCase(), args };
    }
    const parts = [t.v];
    while (this.isOp('.')) {
      this.pos++;
      const n = this.peek();
      if (n?.t !== 'id') throw new Error('expected identifier');
      parts.push(n.v);
      this.pos++;
    }
    return { k: 'path', parts };
  }
}

function toBool(x: SqlValue): boolean | typeof UNDEFINED {
  if (typeof x === 'boolean') return x;
  if (typeof x === 'string') {
    const l = x.toLowerCase();
    if (l === 'true') return true;
    if (l === 'false') return false;
  }
  return UNDEFINED;
}

function toNum(x: SqlValue): number | typeof UNDEFINED {
  if (typeof x === 'number') return x;
  if (typeof x === 'string' && DECIMAL_RE.test(x)) return Number(x);
  return UNDEFINED;
}

function deepEqual(a: SqlValue, b: SqlValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]!));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k]!, b[k]!));
  }
  return false;
}

function typeOf(x: SqlValue): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  return typeof x;
}

function timeToEpoch(s: SqlValue, pattern: SqlValue): number {
  if (pattern !== SUPPORTED_PATTERN) throw new Error('unsupported pattern');
  if (typeof s !== 'string' || !TS_RE.test(s)) throw new Error('time_to_epoch failed');
  let iso = s;
  const m = /([+-])(\d{2}):?(\d{2})?$/.exec(s);
  if (m) iso = s.slice(0, s.length - m[0].length) + `${m[1]}${m[2]}:${m[3] ?? '00'}`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error('time_to_epoch failed');
  return ms;
}

function evalNode(n: Node, payload: unknown, ctx: SqlContext): SqlValue {
  switch (n.k) {
    case 'lit':
      return n.v;
    case 'path': {
      let cur: unknown = payload;
      for (const p of n.parts) {
        if (cur === null || typeof cur !== 'object' || Array.isArray(cur) || !Object.hasOwn(cur, p)) return UNDEFINED;
        cur = (cur as Record<string, unknown>)[p];
      }
      return cur as SqlValue;
    }
    case 'not': {
      const b = toBool(evalNode(n.e, payload, ctx));
      return b === UNDEFINED ? UNDEFINED : !b;
    }
    case 'bin': {
      const l = evalNode(n.l, payload, ctx);
      const r = evalNode(n.r, payload, ctx);
      if (n.op === 'AND' || n.op === 'OR') {
        const a = toBool(l);
        const b = toBool(r);
        if (a === UNDEFINED || b === UNDEFINED) return UNDEFINED;
        return n.op === 'AND' ? a && b : a || b;
      }
      if (l === UNDEFINED || r === UNDEFINED) return UNDEFINED;
      if (n.op === '=') return typeOf(l) === typeOf(r) && deepEqual(l, r);
      if (n.op === '<>') return !(typeOf(l) === typeOf(r) && deepEqual(l, r));
      const a = toNum(l);
      const b = toNum(r);
      if (a === UNDEFINED || b === UNDEFINED) return UNDEFINED;
      switch (n.op) {
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        default: return a <= b;
      }
    }
    case 'call': {
      if (n.name === 'get_or_default') {
        let v: SqlValue;
        try { v = evalNode(n.args[0]!, payload, ctx); } catch { v = UNDEFINED; }
        if (v === UNDEFINED || v === null) return n.args[1] ? evalNode(n.args[1], payload, ctx) : UNDEFINED;
        return v;
      }
      const args = n.args.map((a) => evalNode(a, payload, ctx));
      if (n.name === 'topic') {
        if (args.length === 0) return ctx.topic;
        const i = args[0];
        if (typeof i !== 'number') return UNDEFINED;
        return ctx.topic.split('/')[i - 1] ?? UNDEFINED;
      }
      if (n.name === 'time_to_epoch') return timeToEpoch(args[0] ?? UNDEFINED, args[1] ?? UNDEFINED);
      throw new Error(`unsupported function: ${n.name}`);
    }
  }
}

export function evaluateExpression(expr: string, payload: unknown, ctx: SqlContext): SqlValue {
  return evalNode(new Parser(tokenize(expr)).parse(), payload, ctx);
}

/** True only when the expression evaluates to Boolean `true`. */
export function evaluateWhere(where: string, payload: unknown, ctx: SqlContext): boolean {
  return evaluateExpression(where, payload, ctx) === true;
}
