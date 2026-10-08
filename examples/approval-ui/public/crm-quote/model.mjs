export function authorization(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`;
}
/** Exact decimal helpers for the isolated CRM sample. No binary floating-point amount calculations. */
export function priceMinor(value, currency) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/.test(value)) throw new Error('price');
  const [whole, fraction = ''] = value.split('.');
  if (currency === 'JPY' && /[1-9]/.test(fraction)) throw new Error('jpy');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor <= 0n || minor > 100000000000n) throw new Error('price');
  return minor;
}
export function money(minor, currency) {
  const whole = minor / 100n;
  return currency === 'JPY' ? String(whole) : `${whole}.${String(minor % 100n).padStart(2, '0')}`;
}
export function preview(quote, requested) {
  if (!Number.isInteger(quote.quantity) || quote.quantity < 1 || quote.quantity > 100000) throw new Error('quantity');
  const list = priceMinor(String(quote.listUnitPrice), quote.currency);
  const price = priceMinor(requested, quote.currency);
  if (price >= list) throw new Error('discount');
  const quantity = BigInt(quote.quantity);
  return { listTotal: money(list * quantity, quote.currency), requestedTotal: money(price * quantity, quote.currency), reductionTotal: money((list - price) * quantity, quote.currency) };
}
export function submissionBody(quote, { title, reason, requested }, processVersion) {
  preview(quote, requested);
  if (typeof title !== 'string' || !title.trim() || title.length > 120 || typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw new Error('text');
  const business = { type: 'quoteDiscount', businessId: quote.businessId, title, reason, customerRef: quote.customerRef,
    quoteRevision: quote.revision, item: quote.item, quantity: quote.quantity, listUnitPrice: quote.listUnitPrice, currency: quote.currency, validUntil: quote.validUntil };
  // Only a syntactically validated decimal is inserted as a JSON number. Never convert money with Number().
  return `{"business":${JSON.stringify(business).slice(0, -1)},"requestedUnitPrice":${requested}},"processVersion":${JSON.stringify(processVersion)}}`;
}
export function canDecide(request, actor) {
  if (!request || request.business?.type !== 'quoteDiscount' || request.status !== 'PENDING' || !Array.isArray(request.history)) return false;
  const step = request.definition?.nodes?.find(node => node.id === request.currentStepId);
  return step?.type === 'approval' && step.assigneeId === actor && !request.history.some(event => event.stepId === step.id && event.actorId === actor);
}
export function validateViews(views) {
  if (!Array.isArray(views)) throw new Error('response');
  for (const view of views) {
    const q = view?.request?.business;
    if (q?.type !== 'quoteDiscount' || typeof view.request.id !== 'string' || !['PENDING', 'APPROVED', 'REJECTED'].includes(view.request.status)) throw new Error('response');
    const calculated = preview({ ...q }, String(q.requestedUnitPrice));
    for (const field of ['listTotal', 'requestedTotal', 'reductionTotal']) if (view[field] !== calculated[field]) throw new Error('response');
    if (typeof view.expired !== 'boolean' || typeof view.quoteUpdated !== 'boolean' || typeof view.thresholdReached !== 'boolean' || !/^\d+(\.\d+)?$/.test(view.discountPercent)) throw new Error('response');
  }
  return views;
}
