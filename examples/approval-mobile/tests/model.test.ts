import { describe, it, expect } from "vitest";
import { canDecide, filterRequests, stepState } from "../src/domain/model";
import type { AuditEvent, Request, Step, Status } from "../src/domain/types";
import { request } from "./fixtures";
describe("mobile group projections", () => {
  it("includes Carol despite compatibility approverId Bob and excludes the applicant", () => {
    expect(canDecide(request(), "carol")).toBe(true);
    expect(canDecide(request(), "alice")).toBe(false);
  });
  it("keeps a pending group in My decisions after this actor votes", () => {
    const r = request();
    r.history.push({
      actorId: "bob",
      action: "APPROVE",
      comment: "Done",
      stepId: "team",
      at: r.updatedAt,
    });
    expect(filterRequests([r], "bob", "todo", "")).toHaveLength(0);
    expect(filterRequests([r], "bob", "done", "")).toHaveLength(1);
    expect(filterRequests([r], "carol", "todo", "")).toHaveLength(1);
  });
  it("filters and sorts without mutating server records", () => {
    const a = request(),
      b = request({
        id: "r2",
        title: "Travel",
        updatedAt: "2026-10-06T00:00:00Z",
      });
    const original = [a, b];
    expect(filterRequests(original, "bob", "all", "")).toEqual([b, a]);
    expect(filterRequests(original, "bob", "todo", " family ")).toHaveLength(2);
    expect(original).toEqual([a, b]);
    expect(filterRequests(original, "bob", "todo", "absent")).toEqual([]);
  });
  it("matches independent transitions across all 2,304 reachable mixed three-step states", () => {
    const variants: Partial<Step>[] = [
      { type: "approval", assigneeId: "bob" },
      { type: "approval", assigneeId: "carol" },
      {
        type: "parallelApproval",
        assigneeId: null,
        assigneeIds: ["bob", "carol"],
        completionMode: "ALL",
      },
      {
        type: "parallelApproval",
        assigneeId: null,
        assigneeIds: ["bob", "carol"],
        completionMode: "ANY",
      },
    ];
    let count = 0;
    const members = (n: Step) =>
      n.type === "approval" ? [n.assigneeId!] : n.assigneeIds!;
    for (const a of variants)
      for (const b of variants)
        for (const c of variants) {
          const steps = [a, b, c].map(
            (n, i) => ({ ...n, id: `s${i}`, name: `Step ${i}` }) as Step,
          );
          function visit(
            index: number,
            status: Status,
            history: AuditEvent[],
            outcomes: string[],
          ) {
            const step = steps[index],
              votes = history.filter((e) => e.stepId === step.id),
              pending =
                status === "PENDING"
                  ? members(step).filter(
                      (id) => !votes.some((e) => e.actorId === id),
                    )
                  : [];
            const r = request({
              status,
              history,
              currentStepId: status === "PENDING" ? step.id : null,
              definition: {
                id: "leave-approval",
                version: 1,
                name: "Mixed",
                nodes: steps,
              },
            });
            for (const actor of ["alice", "bob", "carol"])
              expect(canDecide(r, actor)).toBe(pending.includes(actor));
            steps.forEach((n, i) =>
              expect(stepState(r, n)).toBe(
                outcomes[i] ||
                  (i === index && status === "PENDING"
                    ? "current"
                    : status === "PENDING"
                      ? "upcoming"
                      : "skipped"),
              ),
            );
            count++;
            if (status !== "PENDING") return;
            for (const actorId of pending)
              for (const action of ["APPROVE", "REJECT"] as const) {
                const h = [
                    ...history,
                    {
                      actorId,
                      action,
                      comment: "",
                      stepId: step.id,
                      at: r.updatedAt,
                    },
                  ],
                  v = h.filter((e) => e.stepId === step.id),
                  all =
                    step.type === "approval" || step.completionMode === "ALL";
                const approved = all
                  ? v.every((e) => e.action === "APPROVE") &&
                    v.length === members(step).length
                  : v.some((e) => e.action === "APPROVE");
                const rejected = all
                  ? v.some((e) => e.action === "REJECT")
                  : v.every((e) => e.action === "REJECT") &&
                    v.length === members(step).length;
                const out = [...outcomes];
                if (rejected) {
                  out[index] = "rejected";
                  visit(index, "REJECTED", h, out);
                } else if (approved) {
                  out[index] = "approved";
                  visit(
                    index === 2 ? index : index + 1,
                    index === 2 ? "APPROVED" : "PENDING",
                    h,
                    out,
                  );
                } else visit(index, "PENDING", h, out);
              }
          }
          visit(0, "PENDING", [], []);
        }
    expect(count).toBe(2304);
  });
});
