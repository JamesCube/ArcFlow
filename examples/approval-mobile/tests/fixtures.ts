import type { Request, Step } from "../src/domain/types";
export function request(overrides: Partial<Request> = {}): Request {
  const nodes: Step[] = [
    { id: "start", type: "start", name: "Start", assigneeId: null },
    {
      id: "team",
      type: "parallelApproval",
      name: "Team review",
      assigneeId: null,
      assigneeIds: ["bob", "carol"],
      completionMode: "ALL",
    },
    { id: "end", type: "end", name: "End", assigneeId: null },
  ];
  return {
    id: "r1",
    title: "Quarterly planning leave",
    reason: "Family time",
    days: 3,
    applicantId: "alice",
    approverId: "bob",
    status: "PENDING",
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
    processId: "leave-approval",
    processVersion: 1,
    currentStepId: "team",
    history: [
      {
        actorId: "alice",
        action: "SUBMIT",
        comment: "",
        at: "2026-10-05T00:00:00Z",
        stepId: null,
      },
    ],
    definition: { id: "leave-approval", version: 1, name: "Leave", nodes },
    ...overrides,
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Small server stub for legacy tests; the pagination suite controls pages explicitly.
export function listResponse(path: string, rows: Request[], actor = "bob") {
  if (!path.startsWith("/requests/inbox")) return rows;
  const query = new URLSearchParams(path.split("?")[1]);
  const items = rows.filter((item) => {
    const step = item.definition.nodes.find((node) => node.id === item.currentStepId);
    const members = step?.type === "parallelApproval" ? step.assigneeIds || [] : [step?.assigneeId];
    const eligible = query.get("box") === "PENDING"
      ? item.status === "PENDING" && members.includes(actor) && !item.history.some((event) => event.actorId === actor && event.stepId === item.currentStepId)
      : item.history.some((event) => event.actorId === actor && event.action !== "SUBMIT");
    return eligible && (!query.has("status") || item.status === query.get("status")) &&
      (!query.has("processVersion") || item.processVersion === Number(query.get("processVersion")));
  });
  return { items, nextCursor: null };
}

export function approved(item = request()): Request {
  return { ...item, status: "APPROVED", currentStepId: null, history: [...item.history,
    { actorId: "bob", action: "APPROVE", comment: "", at: item.updatedAt, stepId: "team" },
    { actorId: "carol", action: "APPROVE", comment: "", at: item.updatedAt, stepId: "team" },
  ] };
}
