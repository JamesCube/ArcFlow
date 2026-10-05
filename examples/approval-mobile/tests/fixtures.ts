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
