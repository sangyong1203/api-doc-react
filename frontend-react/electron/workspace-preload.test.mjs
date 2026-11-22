import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { randomUUID, webcrypto } from 'node:crypto'

function fixture(invoke, timers = {}) {
  let bridge
  const calls = []
  const context = vm.createContext({ exports: {}, process: { versions: { electron: 'test', node: 'test', chrome: 'test' } }, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, ...timers })
  const realm = value => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context)
  context.require = name => {
    assert.equal(name, 'electron', 'sandbox preload must not require local modules')
    return { contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value } }, ipcRenderer: {
      on() {}, send() {}, removeListener() {}, invoke: async (channel, request) => { calls.push(channel); return realm(await invoke(channel, request)) },
    } }
  }
  vm.runInContext(readFileSync('dist-electron/electron/preload.cjs', 'utf8'), context)
  return { bridge, calls, realm }
}
const request = () => ({ requestId: randomUUID(), payload: { source: 'dialog' } })

test('Preload는 구현된 여섯 채널만 노출하고 취소 응답을 성공으로 구분한다', async () => {
  const { bridge, realm, calls } = fixture((_channel, request) => ({ requestId: request.requestId, ok: true, data: { status: 'cancelled' } }))
  assert.deepEqual(Object.keys(bridge.workspace).sort(), ['commit', 'commitStatus', 'create', 'open', 'release', 'snapshot'])
  const result = await bridge.workspace.open(realm(request()))
  assert.equal(result.ok, true); assert.equal(result.data.status, 'cancelled')
  assert.deepEqual(calls, ['workspace:open'])
  assert.equal(bridge.invoke, undefined)
})

test('Preload는 불일치 추적 ID와 잘못된 snapshot·오류 필드를 거부한다', async () => {
  for (const reply of [
    { requestId: randomUUID(), ok: true, data: { status: 'cancelled' } },
    { ok: true, data: { status: 'opened', connection: {}, snapshot: {} } },
    { ok: false, error: { code: 'FILE_READ_FAILED', message: 'safe', path: '/private' } },
  ]) {
    const { bridge, realm } = fixture((_channel, request) => ({ requestId: request.requestId, ...reply }))
    const result = await bridge.workspace.open(realm(request()))
    assert.equal(result.ok, false); assert.equal(result.error.code, 'IPC_UNAVAILABLE')
  }
})

test('Preload는 잘못된 요청 ID와 원본 invoke 예외를 반사하지 않는다', async () => {
  const { bridge, realm, calls } = fixture(() => { throw new Error('/private/token') })
  const invalid = await bridge.workspace.open(realm({ requestId: '/private/token', payload: {} }))
  assert.equal(invalid.error.code, 'INVALID_REQUEST'); assert.notEqual(invalid.requestId, '/private/token'); assert.equal(calls.length, 0)
  const failed = await bridge.workspace.open(realm(request()))
  assert.equal(failed.error.code, 'IPC_UNAVAILABLE'); assert.equal(failed.error.message.includes('token'), false)
})

test('Preload는 snapshot 대기에 timeout을 적용하고 네이티브 폴더 선택 대기는 강제 중단하지 않는다', async () => {
  let timers = 0
  const pending = fixture(() => new Promise(() => {}), { setTimeout: callback => { timers += 1; callback(); return 0 } })
  const result = await pending.bridge.workspace.snapshot(pending.realm({ requestId: randomUUID(), payload: { handle: randomUUID() } }))
  assert.equal(result.error.code, 'IPC_TIMEOUT'); assert.equal(timers, 1)
  const dialog = fixture((_channel, request) => ({ requestId: request.requestId, ok: true, data: { status: 'cancelled' } }), { setTimeout: () => { throw new Error('dialog timer should not run') } })
  assert.equal((await dialog.bridge.workspace.open(dialog.realm(request()))).ok, true)
})


test('Preload는 저장 결과·상태를 검사하고 고정 저장 채널만 호출한다', async () => {
  const result = { operationId: randomUUID(), revision: `sha256:${'a'.repeat(64)}`, documents: [{ kind: 'api', id: randomUUID(), hash: `sha256:${'b'.repeat(64)}` }], history: 'recorded' }
  const { bridge, realm, calls } = fixture((channel, request) => ({ requestId: request.requestId, ok: true, data: channel === 'workspace:commit' ? result : { status: 'committed', result } }))
  assert.equal((await bridge.workspace.commit(realm(request()))).data.history, 'recorded')
  assert.equal((await bridge.workspace.commitStatus(realm(request()))).data.status, 'committed')
  assert.deepEqual(calls, ['workspace:commit', 'workspace:commit-status'])
  for (const data of [{ ...result, history: 'saved?' }, { ...result, path: '/private' }, { ...result, documents: [{ kind: 'api', id: randomUUID(), hash: 'invalid' }] }]) {
    const invalid = fixture((_channel, request) => ({ requestId: request.requestId, ok: true, data }))
    assert.equal((await invalid.bridge.workspace.commit(invalid.realm(request()))).error.code, 'IPC_UNAVAILABLE')
  }
})

test('저장 응답 유실은 timeout으로 반환하고 상태 조회를 자동 재전송하지 않는다', async () => {
  let milliseconds
  const { bridge, realm, calls } = fixture(() => new Promise(() => {}), { setTimeout: (callback, duration) => { milliseconds = duration; callback(); return 0 } })
  assert.equal((await bridge.workspace.commit(realm(request()))).error.code, 'IPC_TIMEOUT')
  assert.equal(milliseconds, 30000)
  assert.deepEqual(calls, ['workspace:commit'])
})
