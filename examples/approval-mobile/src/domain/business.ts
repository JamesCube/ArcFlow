import type {
  AuditEvent,
  InboxPage,
  BusinessDocument,
  Currency,
  ProcurementBusiness,
  Request,
  Step,
} from "./types";

/** Deliberately contains no server-controlled response text. */
export class InvalidPayloadError extends Error {
  constructor() {
    super("Invalid approval response");
    this.name = "InvalidPayloadError";
  }
}

function invalid(): never {
  throw new InvalidPayloadError();
}

class NumberToken {
  constructor(readonly source: string) {}
}

/**
 * Retain JSON number lexemes before native JSON.parse can round them. A reviver
 * is too late: 1.00000000000000001 and 1000000000.00000001 already lose data.
 * Strings alone use JSON.parse for escape handling. Duplicate keys fail closed,
 * including equivalent escaped keys, rather than accepting the last value.
 */
function readJson(source: string): unknown {
  if (typeof source !== "string") return invalid();
  let position = 0;
  const whitespace = () => {
    while (/[\x20\t\r\n]/.test(source[position] || "!")) position++;
  };
  function string(): string {
    const start = position++;
    while (position < source.length) {
      const character = source[position++];
      if (character === "\\") position++;
      else if (character === '"') {
        try {
          return JSON.parse(source.slice(start, position)) as string;
        } catch {
          return invalid();
        }
      }
    }
    return invalid();
  }
  function value(depth: number): unknown {
    if (depth > 64) return invalid();
    whitespace();
    const character = source[position];
    if (character === '"') return string();
    if (character === "{") {
      position++;
      whitespace();
      const result: Record<string, unknown> = Object.create(null);
      if (source[position] === "}") {
        position++;
        return result;
      }
      while (position < source.length) {
        whitespace();
        if (source[position] !== '"') return invalid();
        const key = string();
        if (Object.hasOwn(result, key)) return invalid();
        whitespace();
        if (source[position++] !== ":") return invalid();
        result[key] = value(depth + 1);
        whitespace();
        const delimiter = source[position++];
        if (delimiter === "}") return result;
        if (delimiter !== ",") return invalid();
      }
      return invalid();
    }
    if (character === "[") {
      position++;
      whitespace();
      const result: unknown[] = [];
      if (source[position] === "]") {
        position++;
        return result;
      }
      while (position < source.length) {
        result.push(value(depth + 1));
        whitespace();
        const delimiter = source[position++];
        if (delimiter === "]") return result;
        if (delimiter !== ",") return invalid();
      }
      return invalid();
    }
    for (const [token, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (source.startsWith(token, position)) {
        position += token.length;
        return result;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      source.slice(position),
    );
    if (!number) return invalid();
    position += number[0].length;
    return new NumberToken(number[0]);
  }
  const result = value(0);
  whitespace();
  if (position !== source.length) return invalid();
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof NumberToken
  ) return invalid();
  return value as Record<string, unknown>;
}

function fields(value: unknown, expected: readonly string[]) {
  const object = record(value);
  const actual = Object.keys(object);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(object, key))
  ) return invalid();
  return object;
}

// Match Java String.trim / Character.isWhitespace instead of JS trim, which
// also strips NBSP/FEFF and would reject valid immutable backend text.
const serverTrim = (value: string) => value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
const serverBlank = (value: string) => /^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]*$/.test(value);
function text(value: unknown, max: number, allowBlank = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowBlank && serverBlank(value))
  ) return invalid();
  return value;
}

function identifier(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) return invalid();
  return value;
}

function actor(value: unknown): string {
  const result = text(value, 128);
  if (/[\x00-\x1f\x7f-\x9f]/.test(result)) return invalid();
  return result;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!(value instanceof NumberToken) || !/^-?(?:0|[1-9]\d*)$/.test(value.source))
    return invalid();
  const parsed = Number(value.source);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    return invalid();
  return parsed;
}

function oneOf<const T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) return invalid();
  return value as T;
}

function timestamp(value: unknown): string {
  const result = text(value, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)
  ) return invalid();
  return result;
}

const currencies = ["CNY", "USD", "EUR", "GBP", "JPY"] as const;
const processIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const stepIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function fromMinorUnits(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function unitPrice(value: unknown, currency: Currency): string {
  if (!(value instanceof NumberToken)) return invalid();
  const parts = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.source);
  if (!parts) return invalid();
  const fraction = parts[2] || "";
  const exponent = BigInt(parts[3] || "0");
  const scale = BigInt(fraction.length) - exponent;
  // Match BigDecimal's scale limit, without first rounding a JSON number.
  if (scale > 2n) return invalid();
  const coefficient = `${parts[1]}${fraction}`.replace(/^0+/, "");
  const shift = 2n - scale;
  // Reject zero and out-of-range magnitudes before constructing a large bigint.
  if (!coefficient || BigInt(coefficient.length) + shift > 12n) return invalid();
  const cents = BigInt(coefficient) * 10n ** shift;
  if (cents > 100_000_000_000n || (currency === "JPY" && cents % 100n !== 0n))
    return invalid();
  return fromMinorUnits(cents);
}

function minorUnits(price: string, currency: Currency): bigint {
  oneOf(currency, currencies);
  if (typeof price !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(price))
    return invalid();
  const [whole, fraction = ""] = price.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (currency === "JPY" && cents % 100n !== 0n) return invalid();
  return cents;
}

/** Currency code is explicit, avoiding ambiguous currency symbols and floats. */
export function formatMoney(price: string, currency: Currency): string {
  const cents = minorUnits(price, currency);
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${whole}${currency === "JPY" ? "" : `.${(cents % 100n).toString().padStart(2, "0")}`}`;
}

/** Even the maximum 100,000 × 1,000,000,000 stays exact in minor units. */
export function procurementTotal(business: ProcurementBusiness): string {
  if (!Number.isInteger(business.quantity) || business.quantity < 1 || business.quantity > 100_000)
    return invalid();
  const price = minorUnits(business.unitPrice, business.currency);
  if (price <= 0n || price > 100_000_000_000n) return invalid();
  return fromMinorUnits(price * BigInt(business.quantity));
}

function businessDocument(value: unknown): BusinessDocument {
  const raw = record(value);
  const type = oneOf(raw.type, ["leave", "procurement"]);
  const data = fields(raw, [
    "type", "businessId", "title", "reason",
    ...(type === "leave" ? ["days"] : ["item", "quantity", "unitPrice", "currency"]),
  ]);
  const businessId = identifier(data.businessId, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);
  const title = text(data.title, 120);
  const reason = text(data.reason, 2000);
  if (title !== serverTrim(title) || reason !== serverTrim(reason)) return invalid();
  if (type === "leave")
    return { type, businessId, title, reason, days: integer(data.days, 1, 365) };
  const currency = oneOf(data.currency, currencies);
  const item = text(data.item, 240);
  if (item !== serverTrim(item)) return invalid();
  return {
    type, businessId, title, reason, item,
    quantity: integer(data.quantity, 1, 100_000),
    unitPrice: unitPrice(data.unitPrice, currency),
    currency,
  };
}

function definition(value: unknown): Request["definition"] {
  const data = fields(value, ["schemaVersion", "id", "version", "name", "nodes"]);
  const schemaVersion = integer(data.schemaVersion, 2, 3) as 2 | 3;
  const name = text(data.name, 120);
  if (/[\x00-\x1f\x7f-\x9f]/.test(name)) return invalid();
  if (!Array.isArray(data.nodes) || data.nodes.length < 3 || data.nodes.length > 10)
    return invalid();
  const ids = new Set<string>();
  const nodes: Step[] = data.nodes.map((value, index) => {
    const raw = record(value);
    const type = oneOf(raw.type, ["start", "end", "approval", "parallelApproval"]);
    const node = fields(raw, [
      "id", "type", "name", "assigneeId",
      ...(type === "parallelApproval" ? ["assigneeIds", "completionMode"] : []),
    ]);
    const id = identifier(node.id, stepIdPattern);
    const name = text(node.name, 120);
    if (ids.has(id) || /[\x00-\x1f\x7f-\x9f]/.test(name)) return invalid();
    ids.add(id);
    if (index === 0 || index === (data.nodes as unknown[]).length - 1) {
      const boundary = index === 0 ? "start" : "end";
      if (type !== boundary || id !== boundary || node.assigneeId !== null) return invalid();
      return { id, type, name, assigneeId: null };
    }
    if (id === "start" || id === "end") return invalid();
    if (type === "approval") return { id, type, name, assigneeId: actor(node.assigneeId) };
    if (type !== "parallelApproval" || schemaVersion !== 3 || node.assigneeId !== null ||
        !Array.isArray(node.assigneeIds) || node.assigneeIds.length < 2 || node.assigneeIds.length > 16)
      return invalid();
    const assigneeIds = node.assigneeIds.map(actor);
    if (new Set(assigneeIds).size !== assigneeIds.length) return invalid();
    return {
      id, type, name, assigneeId: null, assigneeIds,
      completionMode: oneOf(node.completionMode, ["ALL", "ANY"]),
    };
  });
  return {
    schemaVersion,
    id: identifier(data.id, processIdPattern),
    version: integer(data.version, 1, 2_147_483_647),
    name, nodes,
  };
}

function event(value: unknown): AuditEvent {
  const data = fields(value, ["actorId", "action", "comment", "at", "stepId"]);
  return {
    actorId: actor(data.actorId),
    action: oneOf(data.action, ["SUBMIT", "APPROVE", "REJECT"]),
    comment: text(data.comment, 2000, true),
    at: timestamp(data.at),
    stepId: data.stepId === null ? null : identifier(data.stepId, stepIdPattern),
  };
}

function instantNanos(value: string): bigint {
  const fraction = /\.(\d+)Z$/.exec(value)?.[1] || "";
  return BigInt(Date.parse(`${value.slice(0, 19)}Z`)) * 1_000_000n + BigInt(fraction.padEnd(9, "0"));
}

/** Replay only the immutable server snapshot, matching the backend reducer.
 * This is response validation, never a replacement for server authorization.
 */
function validateLifecycle(request: Request): void {
  const stages = request.definition.nodes.slice(1, -1);
  const members = (step: Step): string[] => step.type === "parallelApproval" ? step.assigneeIds! : [step.assigneeId!];
  if (stages.some((step) => members(step).includes(request.applicantId))) return invalid();
  const first = request.history[0];
  if (first.action !== "SUBMIT" || first.actorId !== request.applicantId ||
      first.comment !== "" || first.stepId !== null || first.at !== request.createdAt) return invalid();
  let status: Request["status"] = "PENDING", index = 0;
  let priorTime = instantNanos(request.createdAt);
  const voted = new Set<string>();
  for (const event of request.history.slice(1)) {
    if (status !== "PENDING") return invalid();
    const stage = stages[index], participants = members(stage);
    if (event.stepId !== stage.id || !participants.includes(event.actorId) ||
        event.action === "SUBMIT" || voted.has(event.actorId)) return invalid();
    const at = instantNanos(event.at);
    if (at < priorTime) return invalid();
    priorTime = at;
    voted.add(event.actorId);
    const all = stage.type === "approval" || stage.completionMode === "ALL";
    const approved = event.action === "APPROVE", everyone = voted.size === participants.length;
    if ((all && !approved) || (!all && !approved && everyone)) status = "REJECTED";
    else if ((!all && approved) || (all && everyone)) {
      index++;
      voted.clear();
      if (index === stages.length) status = "APPROVED";
    }
  }
  const last = request.history.at(-1)!;
  const current = status === "PENDING" ? stages[index] : null;
  const approver = current ? members(current).find((actor) => !voted.has(actor)) : last.actorId;
  const noDecisions = request.history.length === 1;
  if (request.status !== status || request.currentStepId !== (current?.id || null) ||
      request.approverId !== approver || request.updatedAt !== last.at ||
      request.decision !== (noDecisions ? null : last.action) ||
      request.comment !== (noDecisions ? null : last.comment)) return invalid();
}

function request(value: unknown): Request {
  const raw = record(value);
  const hasBusiness = Object.hasOwn(raw, "business");
  const data = fields(raw, [
    "id", "title", "reason", "days", "applicantId", "approverId", "status",
    "createdAt", "updatedAt", "decision", "comment", "processId", "processVersion",
    "history", "definition", "currentStepId", ...(hasBusiness ? ["business"] : []),
  ]);
  const business = hasBusiness ? businessDocument(data.business) : undefined;
  const title = text(data.title, 120);
  const reason = text(data.reason, 2000);
  const days = integer(data.days, business?.type === "procurement" ? 0 : 1, 365);
  if (business && (title !== business.title || reason !== business.reason ||
      days !== (business.type === "leave" ? business.days : 0))) return invalid();
  const process = definition(data.definition);
  const processId = identifier(data.processId, processIdPattern);
  const processVersion = integer(data.processVersion, 1, 2_147_483_647);
  if (process.id !== processId || process.version !== processVersion) return invalid();
  if (!Array.isArray(data.history) || data.history.length === 0) return invalid();
  const status = oneOf(data.status, ["PENDING", "APPROVED", "REJECTED"]);
  const currentStepId = data.currentStepId === null ? null : identifier(data.currentStepId, stepIdPattern);
  if (status === "PENDING"
    ? !process.nodes.some((node) => node.id === currentStepId && (node.type === "approval" || node.type === "parallelApproval"))
    : currentStepId !== null) return invalid();
  const result: Request = {
    id: identifier(data.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
    title, reason, days,
    applicantId: actor(data.applicantId),
    approverId: actor(data.approverId),
    status,
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
    decision: data.decision === null ? null : oneOf(data.decision, ["APPROVE", "REJECT"]),
    comment: data.comment === null ? null : text(data.comment, 2000, true),
    processId, processVersion, currentStepId,
    history: data.history.map(event),
    definition: process,
    ...(business ? { business } : {}),
  };
  validateLifecycle(result);
  return result;
}

export function parseRequestJson(source: string): Request {
  return request(readJson(source));
}

/** All-or-nothing decoding prevents a malformed item from enabling decisions. */
export function parseRequestsJson(source: string): Request[] {
  const value = readJson(source);
  if (!Array.isArray(value)) return invalid();
  const requests = value.map(request);
  if (new Set(requests.map((item) => item.id)).size !== requests.length) return invalid();
  return requests;
}

/** Decode inbox rows from original wire tokens, preserving exact money validation. */
export function parseInboxJson(source: string): InboxPage {
  const data = fields(readJson(source), ["items", "nextCursor"]);
  if (!Array.isArray(data.items) || data.items.length > 100 ||
      !(data.nextCursor === null || typeof data.nextCursor === "string" && data.nextCursor.length > 0) ||
      data.nextCursor !== null && data.items.length === 0) return invalid();
  const items = data.items.map(request);
  if (new Set(items.map(item => item.id)).size !== items.length) return invalid();
  return { items, nextCursor: data.nextCursor as string | null };
}
