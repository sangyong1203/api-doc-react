import assert from 'node:assert/strict'

export async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  assert.equal(targets.length, 1, '테스트할 앱 대상은 한 개여야 합니다.')
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const item = pending.get(message.id)
    if (item) {
      pending.delete(message.id)
      clearTimeout(item.timeout)
      if (message.error) { item.reject(new Error(JSON.stringify(message.error))) } else { item.resolve(message.result) }
    }
  })
  return {
    close: () => socket.close(),
    send(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`디버거 응답 시간 초과: ${method}`)) }, 10000)
        pending.set(id, { resolve, reject, timeout })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    async evaluate(expression) {
      const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) { throw new Error(JSON.stringify(result.exceptionDetails)) }
      return result.result.value
    },
  }
}
