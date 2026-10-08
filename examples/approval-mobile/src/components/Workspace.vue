<script setup lang="ts">
import {
  H5Button,
  H5Input,
  H5Textarea,
  H5Label,
} from "../platform/h5-components";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { createApi } from "../domain/api";
import { createWorkspace } from "../domain/workspace";
import { formatMoney, procurementTotal } from "../domain/business";
import {
  currentStep,
  participants,
  stepState,
  votesFor,
} from "../domain/model";
import {
  browserRoute,
  createHostAdapter,
  requestedProvider,
} from "../platform/adapters";
import type { RoutePort, Provider } from "../platform/adapters";
import type { Api, Request, Step, Tab } from "../domain/types";
import { copy, type Locale } from "../copy";
const props = defineProps<{
  api?: Api;
  route?: RoutePort;
  provider?: Provider;
}>();
const workspace = createWorkspace(props.api || createApi());
const { state, selected, visible, actionable, activeInbox, listFresh, listLoading, listError } = workspace;
const locale = ref<Locale>("zh"),
  username = ref("bob"),
  password = ref(""),
  expanded = ref(false),
  filterStatus = ref(""),
  filterVersion = ref("");
const t = computed(() => copy[locale.value]);
const provider =
  props.provider ||
  requestedProvider(typeof location === "undefined" ? "" : location.search);
const host = createHostAdapter(provider);
const isPlatform = host.provider !== "browser";
let route: RoutePort,
  unsubscribe: (() => void) | undefined,
  scroll = 0,
  lastFocus: HTMLElement | null = null;
const todoCount = computed(() => state.inboxes.PENDING.fresh
  ? `${state.inboxes.PENDING.items.length}${state.inboxes.PENDING.nextCursor ? "+" : ""}` : "—");
watch(() => state.me?.id, () => { filterStatus.value = ""; filterVersion.value = ""; });
function applyFilters() { void workspace.setFilters(filterStatus.value, filterVersion.value); }
const person = (id: string) =>
  state.people.find((person) => person.id === id)?.displayName || id;
const status = (request: Request) =>
  ({
    PENDING: t.value.pending,
    APPROVED: t.value.approved,
    REJECTED: t.value.rejected,
  })[request.status];
const requestType = (request: Request) =>
  request.business?.type === "procurement" ? t.value.procurementType : t.value.requestType;
const summary = (request: Request) => request.business?.type === "procurement"
  ? formatMoney(procurementTotal(request.business), request.business.currency)
  : `${request.days} ${t.value.days}`;
const date = (value: string) =>
  new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const mode = (step?: Step) =>
  step?.completionMode === "ALL"
    ? t.value.allMode
    : step?.completionMode === "ANY"
      ? t.value.anyMode
      : t.value.singleMode;
const consequence = computed(() =>
  currentStep(selected.value!)?.completionMode === "ALL"
    ? t.value.allConsequence
    : currentStep(selected.value!)?.completionMode === "ANY"
      ? t.value.anyConsequence
      : t.value.singleConsequence,
);
function stateLabel(request: Request, step: Step) {
  return (
    {
      approved: t.value.approved,
      rejected: t.value.rejected,
      current: t.value.current,
      completed: t.value.completed,
      upcoming: t.value.upcoming,
      skipped: t.value.skipped,
    } as Record<string, string>
  )[stepState(request, step)];
}
async function signIn() {
  const secret = password.value;
  password.value = "";
  await workspace.login(username.value, secret);
}
function open(id: string) {
  scroll = window.scrollY;
  route.open(id);
  window.scrollTo({ top: 0 });
}
function back() {
  route.close();
}
function syncRoute() {
  const old = state.selectedId;
  workspace.route(route.read());
  expanded.value = false;
  if (old && !state.selectedId)
    nextTick(() => window.scrollTo({ top: scroll }));
  if (state.me && state.selectedId && !state.busy) void workspace.refreshDetail();
}
function toggleLocale() {
  locale.value = locale.value === "zh" ? "en" : "zh";
  document.documentElement.lang = locale.value === "zh" ? "zh-CN" : "en";
  document.title =
    locale.value === "zh" ? "ArcFlow · 移动审批" : "ArcFlow · Mobile approvals";
}
function visibility() {
  if (document.visibilityState === "visible" && state.me && !state.busy)
    void workspace.refresh();
}
function keydown(event: KeyboardEvent) {
  if (!state.composer) return;
  if (event.key === "Escape") {
    event.preventDefault();
    workspace.cancel();
  }
  if (event.key === "Tab") {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".decision-dialog button:not([disabled]), .decision-dialog textarea:not([disabled])",
      ),
    );
    const first = controls[0],
      last = controls.at(-1);
    if (!first) {
      event.preventDefault();
      document.querySelector<HTMLElement>(".decision-dialog")?.focus();
      return;
    }
    if (!controls.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
watch(
  () => state.busy,
  async (busy) => {
    if (busy && state.composer) {
      await nextTick();
      document.querySelector<HTMLElement>(".decision-dialog")?.focus();
    }
  },
);
watch(
  () => state.composer,
  async (value) => {
    await nextTick();
    if (value) {
      lastFocus = document.activeElement as HTMLElement;
      document.querySelector<HTMLElement>(".decision-dialog textarea")?.focus();
    } else lastFocus?.focus();
  },
);
onMounted(() => {
  route = props.route || browserRoute();
  workspace.route(route.read());
  unsubscribe = route.subscribe(syncRoute);
  window.addEventListener("keydown", keydown);
  document.addEventListener("visibilitychange", visibility);
});
onUnmounted(() => {
  unsubscribe?.();
  window.removeEventListener("keydown", keydown);
  document.removeEventListener("visibilitychange", visibility);
  workspace.logout();
});
</script>
<template>
  <view class="mobile-shell" :class="{ 'has-actions': selected && actionable }">
    <view class="topbar">
      <view class="wordmark"
        ><view class="brand-symbol" aria-hidden="true"><view /><view /></view
        ><text>{{ t.brand }}</text
        ><text class="wordmark-divider">/</text
        ><text class="product-label">{{ t.product }}</text></view
      >
      <H5Button class="text-button language" @click="toggleLocale">{{
        t.language
      }}</H5Button>
    </view>
    <view v-if="isPlatform" class="login-panel platform-block" role="status">
      <text class="eyebrow">{{ host.provider }}</text
      ><text class="hero-title" role="heading" aria-level="1">{{
        t.platformTitle
      }}</text
      ><text class="body-copy">{{ t.platformBody }}</text>
      <text class="code-label">PROVIDER_NOT_CONFIGURED</text>
    </view>
    <template v-else-if="!state.me">
      <view class="login-panel">
        <text class="eyebrow">ARCFLOW / MOBILE</text
        ><text class="hero-title" role="heading" aria-level="1">{{
          t.welcome
        }}</text
        ><text class="body-copy">{{ t.loginHint }}</text>
        <view class="demo-banner"
          ><view class="live-dot" /><text>{{ t.demo }}</text></view
        >
        <view class="account-picker" role="group" :aria-label="t.username"
          ><H5Button
            v-for="id in ['alice', 'bob', 'carol']"
            :key="id"
            :class="['account-option', { active: username === id }]"
            :aria-pressed="username === id"
            :disabled="state.busy"
            @click="username = id"
            >{{ id[0].toUpperCase() + id.slice(1) }}</H5Button
          ></view
        >
        <H5Label class="field-label" for="demo-password">{{
          t.password
        }}</H5Label>
        <H5Input
          id="demo-password"
          v-model="password"
          class="password-input"
          :password="true"
          type="text"
          autocomplete="current-password"
          :aria-label="t.password"
          :disabled="state.busy"
          @confirm="signIn"
        />
        <view v-if="state.error" class="message error" role="alert">{{
          t.errors[state.error]
        }}</view>
        <H5Button
          class="primary login-submit"
          :disabled="state.busy || !password"
          @click="signIn"
          >{{ state.busy ? t.signing : t.signIn
          }}<text aria-hidden="true">↗</text></H5Button
        >
        <text class="caption login-note">{{ t.demoNote }}</text>
      </view>
      <view class="platform-footer">{{ t.platformFoot }}</view>
    </template>
    <template v-else>
      <view class="identity-bar"
        ><view
          ><text class="avatar small">{{
            state.me.displayName.slice(0, 1)
          }}</text
          ><text>{{ state.me.displayName }}</text
          ><text class="identity-context">{{ t.localOnly }}</text></view
        ><H5Button class="text-button" @click="workspace.logout()">{{
          t.signOut
        }}</H5Button></view
      >
      <view v-if="state.error" class="message error" role="alert"
        ><text>{{ t.errors[state.error] }}</text
        ><H5Button
          class="text-button"
          :disabled="state.loading || state.legacyLoading || state.busy"
          @click="workspace.refresh()"
          >{{ t.retry }}</H5Button
        ></view
      >
      <template v-if="!state.selectedId">
        <view class="page-intro"
          ><text class="eyebrow">{{ t.eyebrow }}</text
          ><view class="heading-row"
            ><text class="page-title" role="heading" aria-level="1">{{
              t.inbox
            }}</text
            ><view class="count-orbit"
              ><text>{{ todoCount }}</text
              ><text class="orbit-label">{{ t.loadedTodo }}</text></view
            ></view
          ><text class="body-copy">{{ t.subtitle }}</text></view
        >
        <view class="segmented" role="tablist"
          ><H5Button
            v-for="tab in ['todo', 'done', 'all'] as Tab[]"
            :key="tab"
            class="tab-button"
            role="tab"
            :aria-selected="state.tab === tab"
            :class="{ active: state.tab === tab }"
            @click="workspace.setTab(tab)"
            >{{ t[tab] }}</H5Button
          ></view
        >
        <view v-if="activeInbox" class="inbox-filters">
          <H5Label for="inbox-status" class="field-label">{{ t.statusFilter }}</H5Label>
          <select id="inbox-status" v-model="filterStatus" :disabled="state.busy" @change="applyFilters">
            <option value="">{{ t.anyStatus }}</option>
            <option value="PENDING">{{ t.pending }}</option>
            <option value="APPROVED">{{ t.approved }}</option>
            <option value="REJECTED">{{ t.rejected }}</option>
          </select>
          <H5Label for="inbox-version" class="field-label">{{ t.versionFilter }}</H5Label>
          <view class="filter-version-row">
            <H5Input id="inbox-version" v-model="filterVersion" type="text" inputmode="numeric" :disabled="state.busy" @confirm="applyFilters" />
            <H5Button class="secondary" :disabled="state.busy" @click="applyFilters">{{ t.applyFilters }}</H5Button>
          </view>
          <text class="caption">{{ t.inboxScope }}</text>
        </view>
        <text v-else class="caption list-scope">{{ t.legacyScope }}</text>
        <view class="search-row"
          ><text aria-hidden="true" class="search-icon">⌕</text
          ><H5Input
            v-model="state.query"
            class="search-input"
            :placeholder="t.search"
            :aria-label="t.search"
          /><H5Button
            v-if="state.query"
            class="icon-button"
            :aria-label="t.clearSearch"
            @click="state.query = ''"
            >×</H5Button
          ></view
        >
        <text v-if="activeInbox" class="caption list-scope">{{ t.searchScope }}</text>
        <view class="list-toolbar"
          ><text>{{ visible.length }} {{ activeInbox ? t.loadedCount : t.count }}</text
          ><H5Button
            class="text-button refresh"
            :disabled="state.loading || state.legacyLoading || state.busy"
            @click="workspace.refresh()"
            >{{ state.loading || state.legacyLoading ? t.refreshing : t.refresh
            }}<text aria-hidden="true">↻</text></H5Button
          ></view
        >
        <view
          v-if="listLoading && !visible.length"
          class="empty-state"
          role="status"
          ><view class="loading-line" /><text>{{ t.loading }}</text></view
        >
        <view
          v-else-if="!listFresh && !listLoading"
          class="empty-state"
          role="status"
          ><text class="section-title" role="heading" aria-level="2">{{
            t.loadFailed
          }}</text
          ><text class="body-copy">{{ t.loadFailedBody }}</text
          ><H5Button
            class="secondary"
            :disabled="state.loading || state.legacyLoading || state.busy"
            @click="workspace.refresh()"
            >{{ t.retry }}</H5Button
          ></view
        >
        <view v-else-if="!visible.length" class="empty-state"
          ><view class="empty-symbol" aria-hidden="true">✓</view
          ><text class="section-title" role="heading" aria-level="2">{{
            state.tab === "todo" && !state.query && !state.filters.status && !state.filters.processVersion && !activeInbox?.nextCursor ? t.emptyTodo : t.emptyTitle
          }}</text
          ><text class="body-copy">{{
            state.tab === "todo" && !state.query && !state.filters.status && !state.filters.processVersion && !activeInbox?.nextCursor ? t.emptyTodoBody : t.emptyBody
          }}</text></view
        >
        <view v-else class="request-list">
          <H5Button
            v-for="request in visible"
            :key="request.id"
            class="request-card"
            @click="open(request.id)"
          >
            <view class="card-top"
              ><text class="type-label">{{ requestType(request) }}</text
              ><text :class="['status', request.status.toLowerCase()]"
                ><text class="status-dot" />{{ status(request) }}</text
              ></view
            >
            <text class="request-title">{{ request.title }}</text>
            <view class="card-summary"
              ><text>{{ person(request.applicantId) }}</text
              ><text class="summary-divider">/</text
              ><text>{{ summary(request) }}</text></view
            >
            <text v-if="request.business" class="card-business-id">{{ request.business.businessId }}</text>
            <view class="card-bottom"
              ><text>{{ date(request.createdAt) }}</text
              ><text class="card-arrow" aria-hidden="true">↗</text></view
            >
          </H5Button>
        </view>
        <view v-if="activeInbox" class="pagination" aria-live="polite">
          <view v-if="listError" class="message error" role="alert">{{ listError === "cursor" ? t.errors.cursor : t.pageFailed }}</view>
          <H5Button v-if="activeInbox.nextCursor" class="secondary load-more"
            :disabled="activeInbox.loading || state.loading || state.legacyLoading || state.busy || listError === 'cursor'"
            @click="workspace.loadMore()">{{ activeInbox.loading ? t.loadingMore : t.loadMore }}</H5Button>
          <text v-else-if="activeInbox.fresh && !activeInbox.loading" class="caption">{{ t.endOfList }}</text>
          <text class="caption">{{ t.livePages }}</text>
        </view>
        <text class="quiet-footer">{{ t.demo }} · {{ t.platformFoot }}</text>
      </template>
      <template v-else>
        <view class="detail-navigation"
          ><H5Button class="text-button back" @click="back"
            ><text aria-hidden="true">←</text>{{ t.back }}</H5Button
          ><H5Button
            class="text-button"
            :disabled="state.loading || state.legacyLoading || state.busy"
            @click="workspace.refresh()"
            >{{ state.loading || state.legacyLoading ? t.refreshing : t.refresh }}</H5Button
          ></view
        >
        <view v-if="!selected" class="empty-state"
          ><text class="section-title" role="heading" aria-level="2">{{
            state.loading || state.legacyLoading ? t.loading : t.missingTitle
          }}</text
          ><text class="body-copy">{{ t.missingBody }}</text></view
        >
        <template v-else>
          <view v-if="state.notice" class="message success" role="status"
            ><text class="success-title">{{ t.saved }}</text
            ><text>{{
              selected.status === "PENDING" ? t.savedPending : t.savedTerminal
            }}</text></view
          >
          <view class="detail-hero"
            ><view class="card-top"
              ><text class="type-label">{{ requestType(selected) }}</text
              ><text :class="['status', selected.status.toLowerCase()]"
                ><text class="status-dot" />{{ status(selected) }}</text
              ></view
            ><text class="detail-title" role="heading" aria-level="1">{{
              selected.title
            }}</text
            ><view class="applicant-row"
              ><text class="avatar">{{
                person(selected.applicantId).slice(0, 1)
              }}</text
              ><view
                ><text class="applicant-name">{{
                  person(selected.applicantId)
                }}</text
                ><text class="caption"
                  >{{ t.applicant }} · {{ date(selected.createdAt) }}</text
                ></view
              ></view
            ></view
          >
          <view class="detail-section"
            ><view class="section-heading"
              ><text class="section-number">01</text
              ><text class="section-title" role="heading" aria-level="2">{{
                t.details
              }}</text></view
            >
            <view v-if="selected.business?.type === 'procurement'" class="procurement-detail">
              <view class="amount-block">
                <text class="caption">{{ t.total }}</text>
                <text class="amount-value">{{ summary(selected) }}</text>
                <text class="caption">{{ t.calculationHint }}</text>
              </view>
              <view class="business-fields">
                <view class="business-field"><text class="caption">{{ t.businessId }}</text><text class="business-value business-reference">{{ selected.business.businessId }}</text></view>
                <view class="business-field"><text class="caption">{{ t.item }}</text><text class="business-value">{{ selected.business.item }}</text></view>
                <view class="business-field"><text class="caption">{{ t.quantity }}</text><text class="business-value">{{ selected.business.quantity }}</text></view>
                <view class="business-field"><text class="caption">{{ t.unitPrice }}</text><text class="business-value">{{ formatMoney(selected.business.unitPrice, selected.business.currency) }}</text></view>
                <view class="business-field"><text class="caption">{{ t.currency }}</text><text class="business-value">{{ selected.business.currency }}</text></view>
              </view>
            </view>
            <template v-else>
              <view v-if="selected.business" class="business-field leave-reference"><text class="caption">{{ t.businessId }}</text><text class="business-value business-reference">{{ selected.business.businessId }}</text></view>
              <view class="duration-block"
              ><text class="caption">{{ t.duration }}</text
              ><view
                ><text class="duration-value">{{ selected.days }}</text
                ><text>{{ t.days }}</text></view
              ></view>
            </template>
            <text class="field-label">{{ selected.business?.type === 'procurement' ? t.businessReason : t.reason }}</text>
            <text class="reason-copy">{{ selected.reason }}</text></view
          >
          <view class="detail-section"
            ><H5Button
              class="process-toggle"
              :aria-expanded="expanded"
              @click="expanded = !expanded"
              ><view class="section-heading"
                ><text class="section-number">02</text
                ><text class="section-title" role="heading" aria-level="2">{{
                  t.process
                }}</text></view
              ><text aria-hidden="true">{{
                expanded ? "−" : "+"
              }}</text></H5Button
            ><text class="caption"
              >{{ t.readonly }} · {{ t.version }}
              {{ selected.processVersion }}</text
            ><view v-if="currentStep(selected)" class="current-step"
              ><view class="live-dot" /><view
                ><text class="field-label">{{
                  currentStep(selected)?.name
                }}</text
                ><text class="caption">{{
                  mode(currentStep(selected))
                }}</text></view
              ></view
            >
            <view v-if="expanded" class="process-list"
              ><view
                v-for="step in selected.definition.nodes"
                :key="step.id"
                class="process-step"
                ><view class="process-step-title"
                  ><text>{{ step.name }}</text
                  ><text class="caption">{{
                    stateLabel(selected, step)
                  }}</text></view
                ><text v-if="participants(step).length" class="caption">{{
                  mode(step)
                }}</text
                ><view
                  v-for="id in participants(step)"
                  :key="id"
                  class="participant"
                  ><text>{{ person(id) }}</text
                  ><text>{{
                    votesFor(selected, step).find((e) => e.actorId === id)
                      ?.action === "APPROVE"
                      ? t.approved
                      : votesFor(selected, step).find((e) => e.actorId === id)
                            ?.action === "REJECT"
                        ? t.rejected
                        : stepState(selected, step) === "current"
                          ? t.votePending
                          : ["approved", "rejected"].includes(
                                stepState(selected, step),
                              )
                            ? t.notNeeded
                            : stateLabel(selected, step)
                  }}</text></view
                ></view
              ></view
            >
          </view>
          <view class="detail-section history-section"
            ><view class="section-heading"
              ><text class="section-number">03</text
              ><text class="section-title" role="heading" aria-level="2">{{
                t.record
              }}</text></view
            ><view class="timeline"
              ><view
                v-for="(event, index) in selected.history"
                :key="index"
                class="timeline-item"
                ><view
                  :class="['timeline-dot', event.action.toLowerCase()]"
                /><view class="event-top"
                  ><text class="event-person">{{ person(event.actorId) }}</text
                  ><text class="event-action">{{
                    event.action === "SUBMIT"
                      ? t.submitEvent
                      : event.action === "APPROVE"
                        ? t.approveEvent
                        : t.rejectEvent
                  }}</text></view
                ><text class="caption"
                  >{{ date(event.at)
                  }}<template v-if="event.stepId">
                    ·
                    {{
                      selected.definition.nodes.find(
                        (step) => step.id === event.stepId,
                      )?.name
                    }}</template
                  ></text
                ><text
                  v-if="event.action !== 'SUBMIT'"
                  :class="['event-comment', { muted: !event.comment }]"
                  >{{ event.comment || t.noComment }}</text
                ></view
              ></view
            ></view
          >
          <view
            v-if="!actionable && !state.loading && !state.legacyLoading && !state.busy"
            class="no-action"
            ><text class="field-label">{{ t.noAction }}</text
            ><text class="caption">{{ t.noActionBody }}</text></view
          >
          <view v-if="actionable" class="action-dock"
            ><H5Button
              class="secondary reject-button"
              @click="workspace.compose('REJECT')"
              >{{ t.reject }}</H5Button
            ><H5Button class="primary" @click="workspace.compose('APPROVE')"
              >{{ t.approve }}<text aria-hidden="true">↗</text></H5Button
            ></view
          >
        </template>
      </template>
    </template>
    <view
      v-if="state.composer && selected"
      class="dialog-backdrop"
      @click.self="workspace.cancel()"
    >
      <view
        class="decision-dialog"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="decision-title"
      >
        <view class="dialog-grip" aria-hidden="true" /><view
          class="dialog-title-row"
          ><text
            id="decision-title"
            class="section-title"
            role="heading"
            aria-level="2"
            >{{
              state.composer === "APPROVE" ? t.reviewApprove : t.reviewReject
            }}</text
          ><H5Button
            class="icon-button"
            :aria-label="t.cancel"
            :disabled="state.busy"
            @click="workspace.cancel()"
            >×</H5Button
          ></view
        >
        <text class="decision-request">{{ selected.title }}</text
        ><text v-if="selected.business?.type === 'procurement'" class="decision-business">{{ selected.business.businessId }} · {{ summary(selected) }}</text>
        <text class="consequence">{{ consequence }}</text
        ><H5Label for="decision-comment" class="field-label">{{
          t.opinion
        }}</H5Label
        ><H5Textarea
          id="decision-comment"
          v-model="state.comment"
          class="comment-input"
          :placeholder="t.placeholder"
          :maxlength="2000"
          :disabled="state.busy"
          :aria-label="t.opinion"
        /><view class="comment-meta"
          ><text>{{ t.opinionHint }}</text
          ><text>{{ state.comment.length }}/2000</text></view
        >
        <view v-if="state.error" class="message error" role="alert">{{
          t.errors[state.error]
        }}</view
        ><view class="dialog-actions"
          ><H5Button
            class="secondary"
            :disabled="state.busy"
            @click="workspace.cancel()"
            >{{ t.cancel }}</H5Button
          ><H5Button
            :class="['primary', { danger: state.composer === 'REJECT' }]"
            :disabled="!actionable || state.busy"
            @click="workspace.submit()"
            >{{ state.busy ? t.submitting : t.confirm }}</H5Button
          ></view
        >
      </view>
    </view>
  </view>
</template>
