import { copy } from './copy.mjs';
import { authorization, preview, submissionBody, canDecide, validateViews, currentStepName } from './model.mjs';
const $ = id => document.getElementById(id);
let language = 'zh', auth = '', actor = '', process = null, quotes = [], views = [], busy = false, loaded = false, generation = 0, messageKey = null;
// Unsubmitted opinions belong to one signed-in actor and one saved review step.
// Keep them in memory across translated redraws and recoverable reloads only.
const reviewDrafts = new Map();
const reviewKey = request => JSON.stringify([actor, request.id, request.processVersion ?? request.definition?.version, request.currentStepId]);
const t = key => copy[language][key] || key;
function message(key = null) { messageKey = key; $('message').textContent = key ? t(key) : ''; }
function draftError(error) { return error.message === 'discount' ? 'discountError' : ['price', 'jpy', 'text'].includes(error.message) ? error.message : 'error'; }
function refreshDraftFeedback() {
  if (!loaded || !['price', 'jpy', 'discountError', 'text'].includes(messageKey)) return;
  try { submissionBody(selected(), {title: $('title').value, reason: $('reason').value, requested: $('requested').value}, process.version); message(); }
  catch (error) { message(draftError(error)); }
}
function element(tag, value, className) { const node = document.createElement(tag); if (value != null) node.textContent = value; if (className) node.className = className; return node; }
function details(target, pairs) { target.replaceChildren(); for (const [label, value] of pairs) target.append(element('dt', label), element('dd', String(value))); }
function selected() { return quotes[Number($('quote-select').value)]; }
function setBusy(value) { busy = value; for (const fieldset of document.querySelectorAll('fieldset')) fieldset.disabled = value; $('refresh').disabled = value; $('quote-select').disabled = value; renderRequests(); }
async function api(path, body) {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: auth, 'X-Arcflow-Client': 'approval-demo', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`http-${response.status}`);
  return response.json();
}
function renderSource() {
  const quote = selected();
  $('create-panel').hidden = !quote || quote.ownerId !== actor;
  details($('quote-details'), quote ? [['reference', quote.businessId], ['revision', quote.revision], ['customer', quote.customerRef], ['item', quote.item], ['quantity', quote.quantity], ['listPrice', `${quote.currency} ${quote.listUnitPrice}`], ['validUntil', quote.validUntil]].map(([key, value]) => [t(key), value]) : []);
  $('process-steps').textContent = process ? process.nodes.filter(node => node.type === 'approval').map(node => `${node.name} (${node.assigneeId})`).join(' → ') : '';
  renderPreview();
}
function renderPreview() {
  try { const result = preview(selected(), $('requested').value); details($('preview'), ['listTotal', 'requestedTotal', 'reductionTotal'].map(key => [t(key), `${selected().currency} ${result[key]}`])); }
  catch { $('preview').replaceChildren(); }
}
function renderRequests() {
  $('requests').replaceChildren();
  if (!loaded) return;
  if (!views.length) { $('requests').append(element('p', t('empty'))); return; }
  for (const view of views) {
    const request = view.request, quote = request.business, card = element('article', null, 'record');
    card.append(element('h3', request.title), element('span', t(request.status.toLowerCase()), 'status'));
    const data = element('dl'); details(data, [['reference', quote.businessId], ['revision', quote.quoteRevision], ['submittedBy', request.applicantId], ['item', quote.item], ['quantity', quote.quantity], ['listPrice', `${quote.currency} ${quote.listUnitPrice}`], ['requestedPrice', `${quote.currency} ${quote.requestedUnitPrice}`], ['requestedTotal', `${quote.currency} ${view.requestedTotal}`], ['reductionTotal', `${quote.currency} ${view.reductionTotal}`], ['discount', `${view.discountPercent}%`], ['validUntil', quote.validUntil], ['reason', quote.reason], ['awaiting', currentStepName(request, language)]].map(([key, value]) => [t(key), value])); card.append(data);
    if (view.quoteUpdated) card.append(element('p', t('updated'), 'warning'));
    if (view.expired) card.append(element('p', t('expired'), 'warning'));
    card.append(element('p', t('rule'), 'hint'), element('p', t('notConnected'), 'hint'));
    if (canDecide(request, actor)) {
      const form = element('form'), fieldset = element('fieldset'), label = element('label', t('comment')), input = element('textarea');
      const draftKey = reviewKey(request); input.value = reviewDrafts.get(draftKey) || '';
      input.addEventListener('input', () => { if (input.value) reviewDrafts.set(draftKey, input.value); else reviewDrafts.delete(draftKey); });
      input.maxLength = 2000; input.rows = 2; label.append(input); fieldset.append(label); fieldset.disabled = busy || !loaded;
      const actions = element('div', null, 'actions');
      for (const [decision, key] of [['APPROVE', 'approve'], ['REJECT', 'reject']]) {
        const button = element('button', t(key), key === 'reject' ? 'secondary' : null); button.type = 'button';
        button.addEventListener('click', () => mutate(`/crm/requests/${encodeURIComponent(request.id)}/decisions`, JSON.stringify({stepId: request.currentStepId, decision, comment: input.value}), 'decisionSaved', draftKey));
        actions.append(button);
      }
      fieldset.append(actions); form.append(fieldset); card.append(form);
    }
    $('requests').append(card);
  }
}
async function refresh({ clearMessage = true } = {}) {
  const token = generation; loaded = false; setBusy(true); if (clearMessage) message('loading');
  try {
    const [me, nextProcess, nextQuotes, nextViews] = await Promise.all([api('/me'), api('/crm/process'), api('/crm/quotes'), api('/crm/requests')]);
    if (token !== generation) return;
    validateViews(nextViews);
    if (!Array.isArray(nextQuotes) || nextProcess.id !== 'quote-discount') throw new Error('response');
    actor = me.id; process = nextProcess; quotes = nextQuotes; views = nextViews; loaded = true;
    const activeReviews = new Set(views.filter(view => canDecide(view.request, actor)).map(view => reviewKey(view.request)));
    for (const key of reviewDrafts.keys()) if (!activeReviews.has(key)) reviewDrafts.delete(key);
    $('identity').textContent = me.displayName; $('login-panel').hidden = true; $('workspace').hidden = false;
    $('quote-select').replaceChildren(...quotes.map((quote, index) => { const option = element('option', `${quote.businessId} · v${quote.revision}`); option.value = String(index); return option; }));
    renderSource(); if (clearMessage) message();
  } catch { if (token === generation) { views = []; quotes = []; process = null; renderSource(); message(auth && actor ? 'error' : 'loginError'); } }
  finally { if (token === generation) setBusy(false); }
}
async function mutate(path, body, success, savedReviewKey) {
  if (busy || !loaded) return;
  const token = generation; setBusy(true);
  let result = success;
  try { await api(path, body); } catch (error) { result = error.message === 'http-409' ? 'conflict' : error.message === 'http-403' ? 'forbidden' : error.message === 'http-400' ? 'invalid' : 'uncertain'; }
  if (token !== generation) return;
  if (result === success && savedReviewKey) reviewDrafts.delete(savedReviewKey);
  await refresh({ clearMessage: false }); if (token === generation && loaded) message(result);
}
$('login-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy) return;
  auth = authorization($('username').value, $('password').value); $('password').value = ''; actor = ''; generation++; refresh();
});
function clearSession({ focus = false } = {}) {
  generation++; auth = ''; actor = ''; process = null; quotes = []; views = []; loaded = false;
  reviewDrafts.clear();
  $('identity').textContent = ''; $('quote-select').replaceChildren();
  $('title').value = t('defaultTitle'); $('reason').value = t('defaultReason'); $('requested').value = '850.00';
  setBusy(false); renderSource(); $('workspace').hidden = true; $('login-panel').hidden = false;
  message(); $('password').value = ''; if (focus) $('password').focus();
}
$('logout').addEventListener('click', () => clearSession({ focus: true }));
// Do not retain Basic credentials or authorized snapshots in a back/forward-cache entry.
window.addEventListener('pagehide', () => clearSession());
window.addEventListener('pageshow', event => { if (event.persisted) clearSession(); });
$('refresh').addEventListener('click', () => refresh()); $('quote-select').addEventListener('change', renderSource); $('requested').addEventListener('input', () => { renderPreview(); refreshDraftFeedback(); });
for (const id of ['title', 'reason']) $(id).addEventListener('input', refreshDraftFeedback);
$('quote-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy || !loaded || matchMedia('(max-width:650px)').matches) return;
  try { mutate('/crm/documents', submissionBody(selected(), {title: $('title').value, reason: $('reason').value, requested: $('requested').value}, process.version), 'saved'); }
  catch (error) { message(draftError(error)); }
});
function renderCopy() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; document.title = `${t('title')} · ArcFlow`;
  document.querySelectorAll('[data-copy]').forEach(node => node.textContent = t(node.dataset.copy));
  if (messageKey) message(messageKey);
  if (!actor && (!$('title').value || Object.values(copy).some(c => c.defaultTitle === $('title').value))) $('title').value = t('defaultTitle'); if (!actor && (!$('reason').value || Object.values(copy).some(c => c.defaultReason === $('reason').value))) $('reason').value = t('defaultReason'); renderSource(); renderRequests();
}
$('language').addEventListener('change', () => { language = $('language').value; renderCopy(); }); renderCopy();
