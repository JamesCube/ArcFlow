import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/domain/api";
import {
  formatMoney,
  InvalidPayloadError,
  parseRequestJson,
  parseInboxJson,
  parseRequestsJson,
  procurementTotal,
} from "../src/domain/business";
import type { ProcurementBusiness } from "../src/domain/types";
import { request } from "./fixtures";

function legacy(): Record<string, any> {
  const result = request();
  return {
    ...result,
    decision: null,
    comment: null,
    definition: { ...result.definition, schemaVersion: 3 },
  };
}

function purchase(): Record<string, any> {
  return {
    ...legacy(),
    title: "Office chairs",
    reason: "Team expansion",
    days: 0,
    business: {
      type: "procurement",
      businessId: "PO-123",
      title: "Office chairs",
      reason: "Team expansion",
      item: "Ergonomic chair",
      quantity: 3,
      unitPrice: 199.99,
      currency: "CNY",
    },
  };
}

function withPrice(token: string, currency = "CNY", quantity = 3): string {
  const payload = purchase();
  payload.business.unitPrice = "RAW_PRICE";
  payload.business.currency = currency;
  payload.business.quantity = quantity;
  return JSON.stringify(payload).replace('"RAW_PRICE"', token);
}

function procurement(source = withPrice("199.99")): ProcurementBusiness {
  const business = parseRequestJson(source).business;
  if (business?.type !== "procurement") throw new Error("Expected procurement");
  return business;
}

describe("strict legacy and typed approval wire contract", () => {
  it("retains legacy leave without fabricating a typed business object", () => {
    const source = legacy();
    const parsed = parseRequestJson(JSON.stringify(source));
    expect(parsed).toEqual(source);
    expect(Object.hasOwn(parsed, "business")).toBe(false);
    expect(parsed.definition.schemaVersion).toBe(3);
    expect(parsed.decision).toBeNull();
    expect(parsed.comment).toBeNull();
  });

  it("accepts schema 2 sequential definitions and typed leave", () => {
    const payload = legacy();
    payload.definition.schemaVersion = 2;
    payload.definition.nodes[1] = {
      id: "team", type: "approval", name: "Manager", assigneeId: "bob",
    };
    payload.business = {
      type: "leave", businessId: "HR-1", title: payload.title,
      reason: payload.reason, days: payload.days,
    };
    expect(parseRequestJson(JSON.stringify(payload))).toEqual(payload);
  });

  it("accepts a terminal decision response and preserves the frozen document", () => {
    const payload = purchase();
    payload.status = "REJECTED";
    payload.currentStepId = null;
    payload.decision = "REJECT";
    payload.comment = "Budget not available";
    payload.history.push({
      actorId: "bob", action: "REJECT", comment: payload.comment,
      at: payload.updatedAt, stepId: "team",
    });
    const parsed = parseRequestJson(JSON.stringify(payload));
    expect(parsed.decision).toBe("REJECT");
    expect(parsed.business).toEqual({ ...payload.business, unitPrice: "199.99" });
    expect(parsed.history).toEqual(payload.history);
  });

  it("accepts empty lists and atomically validates mixed legacy/typed lists", () => {
    expect(parseRequestsJson("[]")).toEqual([]);
    expect(parseRequestsJson(JSON.stringify([legacy(), { ...purchase(), id: "p1" }]))).toHaveLength(2);
    const invalid = purchase();
    invalid.business.currency = "XXX";
    expect(() => parseRequestsJson(JSON.stringify([legacy(), { ...invalid, id: "p1" }, { ...purchase(), id: "p2" }])))
      .toThrow(InvalidPayloadError);
  });

  it.each(Object.keys(legacy()))("requires legacy request field %s", (key) => {
    const payload = legacy();
    delete payload[key];
    expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
  });

  it.each(Object.keys(purchase().business))("requires procurement field %s", (key) => {
    const payload = purchase();
    delete payload.business[key];
    expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
  });

  it.each(["type", "businessId", "title", "reason", "days"])("requires typed leave field %s", (key) => {
    const payload = legacy();
    payload.business = { type: "leave", businessId: "HR-1", title: payload.title, reason: payload.reason, days: 3 };
    delete payload.business[key];
    expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
  });

  it.each(["request", "business", "definition", "node", "history"])("rejects unknown fields in %s", (level) => {
    const payload = purchase();
    const target = level === "request" ? payload : level === "business" ? payload.business :
      level === "definition" ? payload.definition : level === "node" ? payload.definition.nodes[1] : payload.history[0];
    target.unexpected = "must fail closed";
    expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
  });

  it.each([null, [], "procurement", 1, false, {}, { type: "expense" }])("rejects an invalid present business %j", (business) => {
    expect(() => parseRequestJson(JSON.stringify({ ...legacy(), business }))).toThrow(InvalidPayloadError);
  });

  it.each([
    ["title", "A different title"], ["reason", "A different reason"], ["days", 3],
  ])("rejects inconsistent procurement flat %s", (key, value) => {
    const payload = purchase();
    payload[key as string] = value;
    expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
  });

  it("rejects inconsistent typed leave days and unnormalized business text", () => {
    const payload = legacy();
    payload.business = { type: "leave", businessId: "HR-1", title: payload.title, reason: payload.reason, days: 2 };
    expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
    for (const key of ["title", "reason", "item"]) {
      const typed = purchase();
      typed.business[key] = ` ${typed.business[key]} `;
      if (key !== "item") typed[key] = typed.business[key];
      expect(() => parseRequestJson(JSON.stringify(typed))).toThrow(InvalidPayloadError);
    }
  });

  it.each([
    ["id", 7], ["title", false], ["reason", null], ["days", "3"],
    ["days", 1.5], ["days", 0], ["days", 366], ["applicantId", []],
    ["approverId", null], ["status", "UNKNOWN"], ["createdAt", "yesterday"],
    ["updatedAt", 1], ["decision", "SUBMIT"], ["comment", {}],
    ["processId", null], ["processVersion", 1.2], ["processVersion", 2147483648],
    ["currentStepId", false], ["currentStepId", null], ["currentStepId", "start"],
    ["history", null], ["history", []], ["definition", []],
  ])("rejects invalid legacy %s=%j", (key, value) => {
    expect(() => parseRequestJson(JSON.stringify({ ...legacy(), [key as string]: value })))
      .toThrow(InvalidPayloadError);
  });

  it.each([
    ["businessId", "bad id"], ["businessId", null], ["title", 3], ["reason", false],
    ["item", ""], ["item", "x".repeat(241)], ["quantity", "3"], ["quantity", null],
    ["quantity", true], ["quantity", 0], ["quantity", -1], ["quantity", 100001],
    ["quantity", 1.5], ["currency", "usd"], ["currency", "XXX"], ["currency", 1],
    ["unitPrice", "199.99"], ["unitPrice", null], ["unitPrice", true],
  ])("rejects invalid procurement %s=%j", (key, value) => {
    const payload = purchase();
    payload.business[key as string] = value;
    expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
  });

  it("requires every definition, node and audit field", () => {
    for (const targetPath of ["definition", "node", "event"] as const) {
      const sample = legacy();
      const target = targetPath === "definition" ? sample.definition :
        targetPath === "node" ? sample.definition.nodes[1] : sample.history[0];
      for (const key of Object.keys(target)) {
        const payload = legacy();
        const value = targetPath === "definition" ? payload.definition :
          targetPath === "node" ? payload.definition.nodes[1] : payload.history[0];
        delete value[key];
        expect(() => parseRequestJson(JSON.stringify(payload)), `${targetPath}.${key}`)
          .toThrow(InvalidPayloadError);
      }
    }
  });

  it("rejects invalid frozen definitions without substituting current process data", () => {
    const mutations = [
      (p: any) => { p.definition.schemaVersion = 4; },
      (p: any) => { p.definition.schemaVersion = "3"; },
      (p: any) => { p.definition.schemaVersion = 2; },
      (p: any) => { p.definition.version = 2; },
      (p: any) => { p.definition.id = "another-process"; },
      (p: any) => { p.definition.nodes[1].assigneeIds = ["bob", "bob"]; },
      (p: any) => { p.definition.nodes[1].assigneeIds = ["bob", 3]; },
      (p: any) => { p.definition.nodes[1].assigneeIds = ["bob"]; },
      (p: any) => { p.definition.nodes[1].assigneeId = "bob"; },
      (p: any) => { p.definition.nodes[1].completionMode = "MAJORITY"; },
      (p: any) => { p.definition.nodes[1].id = "start"; },
      (p: any) => { p.definition.nodes[0].assigneeId = "bob"; },
      (p: any) => { p.definition.nodes[2].type = "approval"; },
      (p: any) => { p.history[0].comment = null; },
      (p: any) => { p.history[0].action = "DELETE"; },
      (p: any) => { p.history[0].stepId = 1; },
    ];
    for (const mutate of mutations) {
      const payload = legacy();
      mutate(payload);
      expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
    }
  });
});

describe("exact decimal tokens and arithmetic", () => {
  it.each([
    ["0.01", "0.01"], ["0.10", "0.1"], ["199.50", "199.5"],
    ["1000000000", "1000000000"], ["1000000000.00", "1000000000"],
    ["1E+9", "1000000000"], ["1e-2", "0.01"], ["19999e-2", "199.99"],
    ["1.00e2", "100"], ["1e+0009", "1000000000"],
  ])("preserves and normalizes %s exactly", (token, expected) => {
    expect(procurement(withPrice(token)).unitPrice).toBe(expected);
  });

  it.each([
    "0", "-0", "-1", "0.001", "1.001", "1.000", "1.00000000000000001",
    "199.990000000000001", "1000000000.00000001", "1000000000.01",
    "1000000001", "1e10", "1e999999", "1e-999999", "1.001e-1",
    "NaN", "Infinity", "-Infinity", "+1", ".5", "1.", "01", "1e", "1e+",
    "1e1.5", "0x10", "undefined", '"1.00"', "true", "null", "{}", "[]",
  ])("rejects malformed, inexact or out-of-range raw token %s", (token) => {
    expect(() => parseRequestJson(withPrice(token))).toThrow(InvalidPayloadError);
  });

  it("does not accept fractional quantity or days disguised by native rounding", () => {
    const raw = withPrice("1").replace('"quantity":3', '"quantity":3.00000000000000001');
    expect(() => parseRequestJson(raw)).toThrow(InvalidPayloadError);
    const legacyRaw = JSON.stringify(legacy()).replace('"days":3', '"days":3.00000000000000001');
    expect(() => parseRequestJson(legacyRaw)).toThrow(InvalidPayloadError);
    expect(() => parseRequestJson(withPrice("1").replace('"quantity":3', '"quantity":3e0')))
      .toThrow(InvalidPayloadError);
  });

  it.each(["CNY", "USD", "EUR", "GBP"])("supports exact %s fractions", (currency) => {
    const item = procurement(withPrice("199.99", currency));
    expect(procurementTotal(item)).toBe("599.97");
    expect(formatMoney(item.unitPrice, item.currency)).toBe(`${currency} 199.99`);
    expect(formatMoney(procurementTotal(item), item.currency)).toBe(`${currency} 599.97`);
  });

  it("supports JPY only as whole amounts, including exponent tokens", () => {
    for (const token of ["10", "10.00", "1e1"]) {
      const item = procurement(withPrice(token, "JPY"));
      expect(formatMoney(procurementTotal(item), item.currency)).toBe("JPY 30");
    }
    for (const token of ["0.01", "10.5", "10.01", "1e-1"])
      expect(() => parseRequestJson(withPrice(token, "JPY"))).toThrow(InvalidPayloadError);
  });

  it("calculates maximum quantity and price without floating point", () => {
    const item = procurement(withPrice("1E+9", "JPY", 100000));
    expect(procurementTotal(item)).toBe("100000000000000");
    expect(formatMoney(procurementTotal(item), "JPY")).toBe("JPY 100,000,000,000,000");
    const fraction = procurement(withPrice("999999999.99", "USD", 100000));
    expect(procurementTotal(fraction)).toBe("99999999999000");
    expect(formatMoney(procurementTotal(fraction), "USD")).toBe("USD 99,999,999,999,000.00");
    expect(procurementTotal(procurement(withPrice("0.10")))).toBe("0.3");
    expect(formatMoney("0.3", "CNY")).toBe("CNY 0.30");
  });

  it("guards formatting and totals against unvalidated caller data", () => {
    const item = procurement();
    for (const quantity of [0, -1, 1.5, 100001, Number.NaN])
      expect(() => procurementTotal({ ...item, quantity })).toThrow(InvalidPayloadError);
    for (const price of ["0", "-1", "1000000000.01", "1.001", "1e2", "NaN"])
      expect(() => procurementTotal({ ...item, unitPrice: price })).toThrow(InvalidPayloadError);
    expect(() => formatMoney("1.5", "JPY")).toThrow(InvalidPayloadError);
    expect(() => formatMoney("1", "XXX" as any)).toThrow(InvalidPayloadError);
  });
});

describe("strict JSON source handling", () => {
  it.each(["", "null", "[]", "true", "1", "{}", "{", "[", "NaN"])("rejects non-request JSON %s", (source) => {
    expect(() => parseRequestJson(source)).toThrow(InvalidPayloadError);
  });

  it("rejects trailing data, trailing commas, duplicate keys and non-JSON whitespace", () => {
    const source = withPrice("199.99");
    for (const bad of [
      `${source}{}`, `${source} null`, `${source.slice(0, -1)},}`,
      source.replace('"unitPrice":199.99', '"unitPrice":199.99,"unitPrice":1'),
      source.replace('"unitPrice":199.99', '"unitPrice":199.99,"unit\\u0050rice":1'),
      source.replace('"id":"r1"', '"id":"r1","id":"r2"'),
      `\u00a0${source}`, `${source}\u000b`,
    ]) expect(() => parseRequestJson(bad)).toThrow(InvalidPayloadError);
    expect(() => parseRequestsJson(`[${source},]`)).toThrow(InvalidPayloadError);
    expect(() => parseRequestsJson(source)).toThrow(InvalidPayloadError);
    expect(() => parseRequestsJson(`[${source},null]`)).toThrow(InvalidPayloadError);
  });

  it("handles escaped strings without interpreting embedded numeric-looking text", () => {
    const payload = purchase();
    payload.title = payload.business.title = 'Chair "unitPrice": 1.00000000000000001';
    payload.reason = payload.business.reason = "Line one\nLine two \\ slash \u4e2d\u6587";
    expect(parseRequestJson(` \r\n\t${JSON.stringify(payload)} \n`).business)
      .toEqual({ ...payload.business, unitPrice: "199.99" });
  });

  it("rejects malformed escapes, control characters and excessive nesting with a safe error", () => {
    for (const source of [
      '{"title":"\\q"}', '{"title":"\\uXXXX"}', '{"title":"unescaped\nnewline"}',
      '{"title":"unfinished\\', `${"[".repeat(70)}0${"]".repeat(70)}`,
    ]) expect(() => parseRequestJson(source)).toThrow(InvalidPayloadError);
    expect(new InvalidPayloadError().message).toBe("Invalid approval response");
  });
});

describe("review-only API response boundary", () => {
  it("decodes lists and decision responses from original text, never rounded response.json", async () => {
    const json = vi.fn(() => { throw new Error("Must not round business numbers"); });
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => `[${withPrice("1E+9")}]`, json })
      .mockResolvedValueOnce({ ok: true, text: async () => withPrice("0.10"), json });
    const api = createApi(fetcher);
    const list = await api.request<any[]>("/requests");
    const result = await api.request<any>("/requests/r1/decisions", { method: "POST" });
    expect(list[0].business.unitPrice).toBe("1000000000");
    expect(result.business.unitPrice).toBe("0.1");
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects an entire malformed transport list and malformed decision response", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => `[${JSON.stringify(legacy())},${withPrice("1.00000000000000001")}]` })
      .mockResolvedValueOnce({ ok: true, text: async () => withPrice("1000000000.00000001") });
    const api = createApi(fetcher);
    await expect(api.request("/requests")).rejects.toBeInstanceOf(InvalidPayloadError);
    await expect(api.request("/requests/r1/decisions", { method: "POST" })).rejects.toBeInstanceOf(InvalidPayloadError);
  });

  it("keeps ordinary /me and /people JSON responses", async () => {
    const json = vi.fn().mockResolvedValue({ id: "bob" });
    const text = vi.fn();
    const api = createApi(vi.fn().mockResolvedValue({ ok: true, json, text }));
    await api.request("/me");
    await api.request("/people");
    expect(json).toHaveBeenCalledTimes(2);
    expect(text).not.toHaveBeenCalled();
  });

  it("blocks mobile authoring, unsupported methods and paths before any network call", async () => {
    const fetcher = vi.fn();
    const api = createApi(fetcher);
    for (const [path, method] of [
      ["/documents", "POST"], ["/documents", "GET"], ["/requests", "POST"],
      ["/requests", "DELETE"], ["/requests/r1/decisions", "GET"],
      ["/requests/r1/decisions", "PUT"], ["/me", "POST"], ["/people", "PATCH"],
      ["/requests/r1", "GET"], ["/requests/../../me", "POST"], ["/process", "GET"],
      ["https://example.com/requests", "GET"], ["/requests?all=true", "GET"],
    ]) await expect(api.request(path, { method })).rejects.toThrow("Unsupported endpoint");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("backend-compatible text and audit lifecycle proof", () => {
  it.each(["\u2003", "\u00a0", "\ufeff", "\u202f"])("preserves server-valid Unicode text edges %s", (edge) => {
    const payload = purchase();
    for (const key of ["title", "reason", "item"]) {
      payload.business[key] = `${edge}${payload.business[key]}${edge}`;
      if (key !== "item") payload[key] = payload.business[key];
    }
    expect(parseRequestJson(JSON.stringify(payload)).business).toEqual({ ...payload.business, unitPrice: "199.99" });
  });
  const decision = (actorId = "bob", action = "APPROVE", stepId = "team", at = "2026-10-05T00:00:01Z") =>
    ({ actorId, action, stepId, at, comment: "Synthetic vote" });
  function withAudit(events: ReturnType<typeof decision>[], mode = "ALL", status = "PENDING", currentStepId: string | null = "team", approverId = "carol") {
    const p = purchase();
    p.definition.nodes[1].completionMode = mode;
    p.history.push(...events);
    const last = p.history.at(-1);
    Object.assign(p, { status, currentStepId, approverId, updatedAt: last.at, decision: last.action, comment: last.comment });
    return p;
  }
  it("accepts partial ALL, completed ALL, pending ANY rejection, ANY acceptance and full rejection", () => {
    for (const payload of [
      withAudit([decision()]),
      withAudit([decision(), decision("carol")], "ALL", "APPROVED", null, "carol"),
      withAudit([decision("bob", "REJECT")], "ANY"),
      withAudit([decision()], "ANY", "APPROVED", null, "bob"),
      withAudit([decision("bob", "REJECT"), decision("carol", "REJECT")], "ANY", "REJECTED", null, "carol"),
    ]) expect(parseRequestJson(JSON.stringify(payload)).status).toBe(payload.status);
  });
  it.each([
    ["terminal with no decision", (p: any) => { p.status = "APPROVED"; p.currentStepId = null; }],
    ["wrong first actor", (p: any) => { p.history[0].actorId = "bob"; }],
    ["first event not submit", (p: any) => { p.history[0].action = "APPROVE"; }],
    ["applicant in routing", (p: any) => { p.definition.nodes[1].assigneeIds[0] = "alice"; }],
    ["changed submit time", (p: any) => { p.history[0].at = "2026-10-05T00:00:01Z"; }],
    ["wrong updated timestamp", (p: any) => { p.updatedAt = "2026-10-05T00:00:01Z"; }],
    ["wrong projected decision", (p: any) => { p.decision = "APPROVE"; }],
    ["wrong projected comment", (p: any) => { p.comment = "Invented"; }],
    ["wrong pending approver", (p: any) => { p.approverId = "carol"; }],
    ["impossible calendar day", (p: any) => { p.createdAt = p.history[0].at = p.updatedAt = "2026-02-30T00:00:00Z"; }],
  ])("rejects %s", (_, mutate) => {
    const payload = purchase();
    (mutate as (p: any) => void)(payload);
    expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
  });
  it("rejects duplicate, foreign, future, post-terminal and nanosecond-out-of-order votes", () => {
    const cases = [
      withAudit([decision(), decision()]),
      withAudit([decision("outsider")]),
      withAudit([decision("bob", "APPROVE", "future")]),
      withAudit([decision(), decision("carol")], "ANY", "APPROVED", null, "carol"),
      withAudit([decision("bob", "SUBMIT")]),
      withAudit([decision("bob", "APPROVE", "team", "2026-10-05T00:00:01.000000002Z"),
        decision("carol", "APPROVE", "team", "2026-10-05T00:00:01.000000001Z")], "ALL", "APPROVED", null, "carol"),
    ];
    for (const payload of cases) expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
  });
});

it("rejects duplicate request IDs rather than rendering ambiguous decision targets", () => {
  expect(() => parseRequestsJson(JSON.stringify([purchase(), purchase()]))).toThrow(InvalidPayloadError);
});

it("replays mixed stages with the same actor eligible again only at the later step", () => {
  const payload = purchase();
  payload.definition.nodes.splice(-1, 0, { id: "final", type: "approval", name: "Final review", assigneeId: "bob" });
  const vote = (actorId: string, stepId: string) => ({ actorId, stepId, action: "APPROVE", comment: "", at: payload.updatedAt });
  payload.history.push(vote("bob", "team"), vote("carol", "team"));
  Object.assign(payload, { currentStepId: "final", approverId: "bob", decision: "APPROVE", comment: "" });
  expect(parseRequestJson(JSON.stringify(payload)).currentStepId).toBe("final");
  payload.history.push(vote("bob", "final"));
  Object.assign(payload, { currentStepId: null, status: "APPROVED" });
  expect(parseRequestJson(JSON.stringify(payload)).status).toBe("APPROVED");
  payload.history.splice(1, 0, vote("bob", "final"));
  expect(() => parseRequestJson(JSON.stringify(payload))).toThrow(InvalidPayloadError);
});


describe("typed inbox raw precision and envelope contract", () => {
  it("decodes mixed procurement and legacy inbox rows without rounding money", () => {
    const source = `{"items":[${withPrice("199.99")},${JSON.stringify({ ...legacy(), id: "leave-2" })}],"nextCursor":"opaque+/="}`;
    const page = parseInboxJson(source);
    expect(page.items[0].business?.type).toBe("procurement");
    expect((page.items[0].business as ProcurementBusiness).unitPrice).toBe("199.99");
    expect(page.items[1].business).toBeUndefined();
    expect(page.nextCursor).toBe("opaque+/=");
  });
  it.each(["1.00000000000000001", "1000000000.00000001", "0", "1e-3"])("rejects unsafe money token %s inside an inbox before native rounding", async token => {
    const source = `{"items":[${withPrice(token)}],"nextCursor":null}`;
    expect(() => parseInboxJson(source)).toThrow(InvalidPayloadError);
    const api = createApi(vi.fn().mockResolvedValue({ ok: true, text: async () => source }));
    await expect(api.request("/requests/inbox?box=PENDING&limit=25")).rejects.toThrow(InvalidPayloadError);
  });
  it.each([
    { items: [], nextCursor: "empty-continuation" },
    { items: [legacy(), legacy()], nextCursor: null },
    { items: [], nextCursor: "" },
    { items: [], nextCursor: null, total: 500 },
    { items: Array.from({ length: 101 }, (_, i) => ({ ...legacy(), id: `row-${i}` })), nextCursor: null },
  ])("rejects malformed or unbounded inbox envelopes", value => {
    expect(() => parseInboxJson(JSON.stringify(value))).toThrow(InvalidPayloadError);
  });
  it("keeps the mobile inbox read-only while retaining explicit decision POST", async () => {
    const fetcher = vi.fn(), api = createApi(fetcher);
    for (const path of ["/requests/inbox?box=PENDING", "/requests", "/documents"])
      await expect(api.request(path, { method: "POST" })).rejects.toThrow("Unsupported endpoint");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
