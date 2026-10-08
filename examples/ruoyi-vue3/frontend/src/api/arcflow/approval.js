// Uses RuoYi's token, error handling, timeout and duplicate-submit interceptor.
// Do not replace this with a second login flow or a standalone fetch client.
import request from '@/utils/request'
import { parseApprovalJson } from '../../views/arcflow/approval/business-document.js'

export const getMe = signal => request({ url: '/arcflow/me', method: 'get', signal })
export const getPeople = signal => request({ url: '/arcflow/people', method: 'get', signal })
export const getProcess = signal => request({ url: '/arcflow/process', method: 'get', signal })
export const getRequests = signal => request({ url: '/arcflow/requests', method: 'get', signal, transformResponse: [parseApprovalJson] })
// RuoYi unwraps the transport response; AjaxResult.data retains the inbox page.
export const getInbox = (params, signal) => request({ url: '/arcflow/requests/inbox', method: 'get', params, signal, transformResponse: [parseApprovalJson] })
export const publishProcess = data => request({ url: '/arcflow/process', method: 'post', data })
// The native interceptor's time-window/body cache is not an idempotency store.
// Keyed retries must reach ArcFlow, including retries within that window.
export const submitRequest = (data, idempotencyKey) => request({
  url: '/arcflow/requests', method: 'post', data, transformResponse: [parseApprovalJson],
  headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey, repeatSubmit: false } : {}
})
// Decode original numeric tokens before Axios can round invalid fractions.
// Additive typed-document API. Authentication/RBAC and duplicate-submit handling
// are exactly the same as the legacy leave route.
export const submitDocument = (data, idempotencyKey) => request({
  url: '/arcflow/documents', method: 'post', data, transformResponse: [parseApprovalJson],
  headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey, repeatSubmit: false } : {}
})
export const decideRequest = (id, data) => request({
  url: `/arcflow/requests/${encodeURIComponent(id)}/decisions`, method: 'post', data, transformResponse: [parseApprovalJson]
})
