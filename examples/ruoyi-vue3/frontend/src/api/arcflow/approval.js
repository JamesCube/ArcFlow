// Uses RuoYi's token, error handling, timeout and duplicate-submit interceptor.
// Do not replace this with a second login flow or a standalone fetch client.
import request from '@/utils/request'

export const getMe = () => request({ url: '/arcflow/me', method: 'get' })
export const getPeople = () => request({ url: '/arcflow/people', method: 'get' })
export const getProcess = () => request({ url: '/arcflow/process', method: 'get' })
export const getRequests = () => request({ url: '/arcflow/requests', method: 'get' })
export const publishProcess = data => request({ url: '/arcflow/process', method: 'post', data })
export const submitRequest = data => request({ url: '/arcflow/requests', method: 'post', data })
export const decideRequest = (id, data) => request({
  url: `/arcflow/requests/${encodeURIComponent(id)}/decisions`, method: 'post', data
})
