import { computed, reactive } from "vue";
import { ApiError } from "./api";
import { canDecide, filterRequests } from "./model";
import type { Api, Person, Request, Decision, Tab } from "./types";
export type ErrorCode =
  | ""
  | "credentials"
  | "expired"
  | "forbidden"
  | "missing"
  | "conflict"
  | "unavailable"
  | "network"
  | "commentLong";
export function createWorkspace(api: Api) {
  let epoch = 0,
    readVersion = 0;
  let context: {
    requestId: string;
    stepId: string;
    decision: Decision;
  } | null = null;
  const state = reactive({
    me: null as Person | null,
    people: [] as Person[],
    requests: [] as Request[],
    busy: false,
    loading: false,
    fresh: false,
    error: "" as ErrorCode,
    notice: false,
    selectedId: "",
    tab: "todo" as Tab,
    query: "",
    composer: null as Decision | null,
    comment: "",
  });
  const selected = computed(() =>
    state.requests.find((request) => request.id === state.selectedId),
  );
  const visible = computed(() =>
    filterRequests(state.requests, state.me?.id || "", state.tab, state.query),
  );
  const actionable = computed(
    () =>
      !!selected.value &&
      !!state.me &&
      state.fresh &&
      !state.loading &&
      !state.busy &&
      canDecide(selected.value, state.me.id),
  );
  function logout(error: ErrorCode = "") {
    context = null;
    epoch++;
    readVersion++;
    api.logout();
    state.me = null;
    state.requests = [];
    state.people = [];
    state.composer = null;
    state.comment = "";
    state.busy = false;
    state.loading = false;
    state.fresh = false;
    state.error = error;
    state.notice = false;
  }
  function failure(error: unknown): ErrorCode {
    if (error instanceof ApiError)
      return (
        (
          {
            401: "expired",
            403: "forbidden",
            404: "missing",
            409: "conflict",
            503: "unavailable",
          } as Record<number, ErrorCode>
        )[error.status] || "unavailable"
      );
    return "network";
  }
  async function refresh(preserveError = false) {
    if (!state.me) return;
    const run = epoch,
      version = ++readVersion;
    state.loading = true;
    state.fresh = false;
    if (!preserveError) state.error = "";
    try {
      const requests = await api.request<Request[]>("/requests");
      if (run !== epoch || version !== readVersion) return;
      state.requests = requests;
      state.fresh = true;
      if (context) {
        const current = requests.find((item) => item.id === context!.requestId);
        if (
          !current ||
          current.currentStepId !== context.stepId ||
          !canDecide(current, state.me!.id)
        ) {
          context = null;
          state.composer = null;
          state.comment = "";
          state.error = "conflict";
        }
      }
    } catch (error) {
      if (run !== epoch || version !== readVersion) return;
      const code = failure(error);
      if (code === "expired") logout("expired");
      else state.error = code;
    } finally {
      if (run === epoch && version === readVersion) state.loading = false;
    }
  }
  async function login(username: string, password: string) {
    if (state.busy) return;
    logout();
    state.busy = true;
    const run = epoch;
    api.login(username, password);
    try {
      const me = await api.request<Person>("/me");
      const people = await api.request<Person[]>("/people");
      if (run !== epoch) return;
      state.me = me;
      state.people = people;
      await refresh();
    } catch (error) {
      if (run === epoch)
        logout(
          error instanceof ApiError && error.status === 401
            ? "credentials"
            : failure(error),
        );
    } finally {
      if (run === epoch) state.busy = false;
    }
  }
  function route(id: string) {
    context = null;
    state.selectedId = id;
    state.composer = null;
    state.comment = "";
    state.notice = false;
  }
  function compose(decision: Decision) {
    if (!actionable.value || !selected.value?.currentStepId) return;
    context = {
      requestId: selected.value.id,
      stepId: selected.value.currentStepId,
      decision,
    };
    state.composer = decision;
    state.comment = "";
    state.error = "";
    state.notice = false;
  }
  function cancel() {
    if (!state.busy) {
      context = null;
      state.composer = null;
      state.comment = "";
      state.error = "";
    }
  }
  async function submit() {
    const request = selected.value,
      decision = state.composer;
    if (!request || !decision || !actionable.value || !context) return;
    if (
      request.id !== context.requestId ||
      request.currentStepId !== context.stepId ||
      decision !== context.decision
    ) {
      context = null;
      state.composer = null;
      state.comment = "";
      state.error = "conflict";
      return;
    }
    if (state.comment.length > 2000) {
      state.error = "commentLong";
      return;
    }
    const run = epoch,
      id = request.id,
      stepId = context.stepId;
    state.busy = true;
    state.error = "";
    state.notice = false;
    ++readVersion;
    state.loading = false;
    try {
      const result = await api.request<Request>(`/requests/${id}/decisions`, {
        method: "POST",
        body: JSON.stringify({ stepId, decision, comment: state.comment }),
      });
      if (run !== epoch) return;
      state.requests = state.requests.map((item) =>
        item.id === id ? result : item,
      );
      context = null;
      state.composer = null;
      state.comment = "";
      state.fresh = true;
      state.notice = state.selectedId === id;
    } catch (error) {
      if (run !== epoch) return;
      const code = failure(error);
      if (code === "expired") logout("expired");
      else {
        state.error = code;
        state.fresh = false;
        await refresh(true);
      }
    } finally {
      if (run === epoch) state.busy = false;
    }
  }
  return {
    state,
    selected,
    visible,
    actionable,
    login,
    logout,
    refresh,
    route,
    compose,
    cancel,
    submit,
  };
}
