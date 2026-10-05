import type { Request, Step, Tab } from "./types";
export const participants = (step?: Step) =>
  step?.type === "parallelApproval"
    ? step.assigneeIds || []
    : step?.type === "approval" && step.assigneeId
      ? [step.assigneeId]
      : [];
export const currentStep = (request: Request) =>
  request.definition.nodes.find((step) => step.id === request.currentStepId);
export const votesFor = (request: Request, step: Step) =>
  request.history.filter((event) => event.stepId === step.id);
// Display hints only: every command is authorized by the server against the saved definition.
export function canDecide(request: Request, actor: string) {
  const step = currentStep(request);
  return (
    request.status === "PENDING" &&
    !!step &&
    participants(step).includes(actor) &&
    !votesFor(request, step).some((event) => event.actorId === actor)
  );
}
export const hasDecided = (request: Request, actor: string) =>
  request.history.some(
    (event) => event.actorId === actor && event.action !== "SUBMIT",
  );
export function filterRequests(
  requests: Request[],
  actor: string,
  tab: Tab,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  return requests
    .filter(
      (request) =>
        (tab === "all" ||
          (tab === "todo"
            ? canDecide(request, actor)
            : hasDecided(request, actor))) &&
        `${request.title} ${request.reason} ${request.applicantId}`
          .toLocaleLowerCase()
          .includes(needle),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function stepState(request: Request, step: Step): string {
  const votes = votesFor(request, step);
  if (step.type === "start") return "completed";
  if (step.type === "end")
    return request.status === "APPROVED"
      ? "completed"
      : request.status === "REJECTED"
        ? "skipped"
        : "upcoming";
  const all = step.type === "approval" || step.completionMode === "ALL";
  if (all && votes.some((e) => e.action === "REJECT")) return "rejected";
  if (!all && votes.some((e) => e.action === "APPROVE")) return "approved";
  if (votes.length === participants(step).length)
    return all ? "approved" : "rejected";
  if (request.status === "PENDING" && request.currentStepId === step.id)
    return "current";
  return request.status === "PENDING" ? "upcoming" : "skipped";
}
