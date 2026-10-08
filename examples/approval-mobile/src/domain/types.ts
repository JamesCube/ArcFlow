export type Decision = "APPROVE" | "REJECT";
export type Status = "PENDING" | "APPROVED" | "REJECTED";
export type Currency = "CNY" | "USD" | "EUR" | "GBP" | "JPY";
export interface LeaveBusiness {
  type: "leave";
  businessId: string;
  title: string;
  reason: string;
  days: number;
}
export interface ProcurementBusiness {
  type: "procurement";
  businessId: string;
  title: string;
  reason: string;
  item: string;
  quantity: number;
  /** Validated exact decimal, never a binary floating-point amount. */
  unitPrice: string;
  currency: Currency;
}
export type BusinessDocument = LeaveBusiness | ProcurementBusiness;
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
  // Optional for existing local fixtures; required (and nullable) on the wire.
  decision?: Decision | null;
  comment?: string | null;
  processId: string;
  processVersion: number;
  currentStepId: string | null;
  history: AuditEvent[];
  definition: {
    schemaVersion?: 2 | 3;
    id: string;
    version: number;
    name: string;
    nodes: Step[];
  };
  business?: BusinessDocument;
}
export interface Api {
  login(username: string, password: string): void;
  logout(): void;
  request<T>(path: string, options?: RequestInit): Promise<T>;
}
export type Tab = "todo" | "done" | "all";

export type InboxBox = "PENDING" | "HANDLED";
export interface InboxFilters {
  status?: Status;
  processVersion?: number;
}
export interface InboxPage {
  items: Request[];
  nextCursor: string | null;
}
