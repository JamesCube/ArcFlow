export type Decision = "APPROVE" | "REJECT";
export type Status = "PENDING" | "APPROVED" | "REJECTED";
export interface Person {
  id: string;
  displayName: string;
}
export interface Step {
  id: string;
  type: "start" | "end" | "approval" | "parallelApproval";
  name: string;
  assigneeId: string | null;
  assigneeIds?: string[];
  completionMode?: "ALL" | "ANY";
}
export interface AuditEvent {
  actorId: string;
  action: "SUBMIT" | Decision;
  comment: string;
  at: string;
  stepId: string | null;
}
export interface Request {
  id: string;
  title: string;
  reason: string;
  days: number;
  applicantId: string;
  approverId: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  processId: string;
  processVersion: number;
  currentStepId: string | null;
  history: AuditEvent[];
  definition: { id: string; version: number; name: string; nodes: Step[] };
}
export interface Api {
  login(username: string, password: string): void;
  logout(): void;
  request<T>(path: string, options?: RequestInit): Promise<T>;
}
export type Tab = "todo" | "done" | "all";
