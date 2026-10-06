// Uses RuoYi's token, error handling, timeout and duplicate-submit interceptor.
// Do not replace this with a second login flow or a standalone fetch client.
import request from '@/utils/request'

export const getMe = () => request({ url: '/arcflow/me', method: 'get' })
export const getPeople = () => request({ url: '/arcflow/people', method: 'get' })
export const getProcess = () => request({ url: '/arcflow/process', method: 'get' })
export const getRequests = () => request({ url: '/arcflow/requests', method: 'get' })
export const publishProcess = data => request({ url: '/arcflow/process', method: 'post', data })
// The native interceptor's time-window/body cache is not an idempotency store.
// Keyed retries must reach ArcFlow, including retries within that window.
export const submitRequest = (data, idempotencyKey) => request({
  url: '/arcflow/requests', method: 'post', data,
  headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey, repeatSubmit: false } : {}
})
export const decideRequest = (id, data) => request({
  url: `/arcflow/requests/${encodeURIComponent(id)}/decisions`, method: 'post', data
})
