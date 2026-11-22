import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, rm } from 'node:fs/promises'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { validateWorkspaceBundle, WORKSPACE_LIMITS } = require('../dist-electron/electron/workspace-format.cjs')
const { selectWorkspaceRoot, createWorkspaceFiles, readWorkspaceSnapshot } = require('../dist-electron/electron/workspace-files.cjs')
const { WorkspaceService, workspaceResult } = require('../dist-electron/electron/workspace-service.cjs')
const { openPersonalDatabase } = require('../dist-electron/electron/personal-database.cjs')
const samples = JSON.parse(readFileSync('../doc/storage-v1.samples.json', 'utf8'))
const code = expected => error => { assert.equal(error.code, expected); return true }
function edit(files, edits = []) {
  const result = structuredClone(files)
  for (const change of edits) {
    if (change.op === 'deleteFile') { delete result[change.file]; continue }
    if (change.op === 'putFile') { result[change.file] = structuredClone(change.value); continue }
    const parent = change.path.slice(0, -1).reduce((value, key) => value[key], result[change.file])
    const key = change.path.at(-1)
    if (change.op === 'remove') { delete parent[key] }
    else if (change.op === 'append') { parent[key].push(structuredClone(change.value)) }
    else { parent[key] = structuredClone(change.value) }
  }
  return result
}
const bundles = new Map()
for (const sample of samples.valid) { bundles.set(sample.name, sample.base ? edit(bundles.get(sample.base), sample.edits) : sample.files) }
const encoded = files => Object.fromEntries(Object.entries(files).map(([file, data]) => [file, JSON.stringify(data)]))
async function fixture(t, files = bundles.get('main')) {
  const directory = await mkdtemp(path.join(tmpdir(), 'apidoc-workspace-'))
  const selected = path.join(directory, 'workspace')
  await mkdir(selected)
  for (const [name, data] of Object.entries(files)) { const file = path.join(selected, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)) }
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, selected, root: await selectWorkspaceRoot(selected) }
}

for (const [name, files] of bundles) { test(`공유 v1 정상 샘플: ${name}`, () => { assert.ok(validateWorkspaceBundle(encoded(files))) }) }
for (const sample of samples.invalid) { test(`공유 v1 오류 샘플 거부: ${sample.name}`, () => { assert.throws(() => validateWorkspaceBundle(encoded(edit(bundles.get(sample.base), sample.edits)))) }) }

test('snapshot은 실제 바이트 hash·고정 순서 revision을 반환하고 원문을 바꾸지 않는다', async t => {
  const { root, selected } = await fixture(t)
  const manifest = await readFile(path.join(selected, 'workspace.json'))
  const snapshot = await readWorkspaceSnapshot(root)
  assert.equal(snapshot.workspace.hash, `sha256:${createHash('sha256').update(manifest).digest('hex')}`)
  const entries = [snapshot.workspace, ...snapshot.apis, ...snapshot.environments].map(doc => [doc.kind === 'workspace' ? 'workspace.json' : `${doc.kind === 'api' ? 'apis' : 'environments'}/${doc.id}.json`, doc.hash]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  assert.equal(snapshot.revision, `sha256:${createHash('sha256').update(JSON.stringify(entries)).digest('hex')}`)
  assert.deepEqual(await readFile(path.join(selected, 'workspace.json')), manifest)
})

test('빈 폴더 생성은 기존 일반 파일을 보존하고 재생성으로 덮어쓰지 않는다', async t => {
  const { selected, root } = await fixture(t, {})
  await writeFile(path.join(selected, 'README.txt'), 'keep me')
  const snapshot = await createWorkspaceFiles(root, '새 작업 공간')
  assert.equal(JSON.parse(snapshot.workspace.json).name, '새 작업 공간')
  assert.equal(snapshot.apis.length, 0)
  await assert.rejects(createWorkspaceFiles(root, 'overwrite'), code('WORKSPACE_ALREADY_EXISTS'))
  assert.equal(await readFile(path.join(selected, 'README.txt'), 'utf8'), 'keep me')
  assert.equal((await readWorkspaceSnapshot(root)).revision, snapshot.revision)
})

test('공개 전 생성 실패는 자신의 빈 관리 폴더만 정리한다', async t => {
  const { root, selected } = await fixture(t, {})
  const original = fs.mkdir
  t.mock.method(fs, 'mkdir', async (directory, ...args) => { if (directory === path.join(root.canonicalPath, 'environments')) { throw Object.assign(new Error('private ENOSPC'), { code: 'ENOSPC' }) }
    return original(directory, ...args) })
  await assert.rejects(createWorkspaceFiles(root, 'test'), code('FILE_WRITE_FAILED'))
  assert.deepEqual(await fs.readdir(selected), [])
})

test('관리 파일·부모 폴더의 symlink와 루트 교체를 거부한다', async t => {
  const { root, selected, directory } = await fixture(t)
  const apiName = Object.keys(bundles.get('main')).find(name => name.startsWith('apis/'))
  const outside = path.join(directory, 'outside.json')
  await writeFile(outside, await readFile(path.join(selected, apiName)))
  await rm(path.join(selected, apiName))
  await symlink(outside, path.join(selected, apiName))
  await assert.rejects(readWorkspaceSnapshot(root), code('PATH_NOT_ALLOWED'))
  await rm(path.join(selected, apiName))
  await writeFile(path.join(selected, apiName), await readFile(outside))
  await fs.rename(path.join(selected, 'apis'), path.join(directory, 'outside-apis'))
  await symlink(path.join(directory, 'outside-apis'), path.join(selected, 'apis'), 'junction')
  await assert.rejects(readWorkspaceSnapshot(root), code('PATH_NOT_ALLOWED'))
  await fs.rename(selected, path.join(directory, 'moved'))
  await symlink(path.join(directory, 'moved'), selected, 'junction')
  await assert.rejects(readWorkspaceSnapshot(root), code('PATH_NOT_ALLOWED'))
})

test('두 번 읽는 사이의 변경은 성공 snapshot 대신 FILE_CONFLICT로 반환한다', async t => {
  const { root } = await fixture(t)
  const original = fs.open
  let manifestReads = 0
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (file === path.join(root.canonicalPath, 'workspace.json') && ++manifestReads === 2) {
      const data = JSON.parse(await readFile(file, 'utf8')); data.name = 'externally changed'; await writeFile(file, JSON.stringify(data))
    }
    return original(file, ...args)
  })
  await assert.rejects(readWorkspaceSnapshot(root), code('FILE_CONFLICT'))
})

test('잘못된 UTF-8·크기 초과를 빈 데이터로 대체하지 않는다', async t => {
  const { root, selected } = await fixture(t, {})
  await writeFile(path.join(selected, 'workspace.json'), Buffer.from([0xff]))
  await assert.rejects(readWorkspaceSnapshot(root), code('DOCUMENT_INVALID'))
  await writeFile(path.join(selected, 'workspace.json'), '\ufeff' + JSON.stringify(bundles.get('empty')['workspace.json']))
  await assert.rejects(readWorkspaceSnapshot(root), code('DOCUMENT_INVALID'))
  await writeFile(path.join(selected, 'workspace.json'), 'x'.repeat(WORKSPACE_LIMITS.fileBytes + 1))
  await assert.rejects(readWorkspaceSnapshot(root), code('PAYLOAD_TOO_LARGE'))
})

test('handle은 창·프레임·manifest에 귀속되고 recent 경로를 Renderer에서 받지 않는다', async t => {
  const { selected, directory } = await fixture(t)
  const database = await openPersonalDatabase({ userData: path.join(directory, 'profile'), appVersion: '0.1.0' })
  t.after(() => database.close())
  const owner = { windowId: 1, frame: {} }
  const service = new WorkspaceService(database, async () => selected, () => true)
  const result = await service.open(owner, { source: 'dialog' })
  assert.equal(result.status, 'opened')
  const handle = result.connection.handle
  assert.equal((await service.snapshot(owner, { handle })).workspace.id, result.connection.workspaceId)
  await assert.rejects(service.snapshot({ ...owner, frame: {} }, { handle }), code('WORKSPACE_NOT_OPEN'))
  await assert.rejects(service.open(owner, { source: 'dialog', path: selected }))
  assert.equal((await service.open(owner, { source: 'recent', localFolderId: result.connection.localFolderId })).connection.handle, handle)
  const file = path.join(selected, 'workspace.json')
  const manifest = JSON.parse(await readFile(file, 'utf8')); manifest.id = randomUUID(); await writeFile(file, JSON.stringify(manifest))
  await assert.rejects(service.open(owner, { source: 'recent', localFolderId: result.connection.localFolderId }), code('WORKSPACE_NOT_OPEN'))
  await assert.rejects(service.snapshot(owner, { handle }), code('WORKSPACE_NOT_OPEN'))
  service.releaseOwner(1)
  assert.throws(() => service.release(owner, { handle }), code('WORKSPACE_NOT_OPEN'))
  await database.close()
})

test('취소·busy는 기존 연결을 유지하며 같은 workspace의 복제 폴더를 구분한다', async t => {
  const { directory, selected } = await fixture(t)
  const clone = path.join(directory, 'clone'); await cp(selected, clone, { recursive: true })
  const database = await openPersonalDatabase({ userData: path.join(directory, 'profile'), appVersion: '0.1.0' })
  try {
    let next = selected
    let resolveSelection
    const owner = { windowId: 1, frame: {} }
    const service = new WorkspaceService(database, () => next === 'wait' ? new Promise(resolve => { resolveSelection = resolve }) : Promise.resolve(next), () => true)
    const first = await service.open(owner, { source: 'dialog' })
    next = clone; const second = await service.open(owner, { source: 'dialog' })
    assert.equal(first.connection.workspaceId, second.connection.workspaceId)
    assert.notEqual(first.connection.localFolderId, second.connection.localFolderId)
    next = 'wait'; const pending = service.open(owner, { source: 'dialog' })
    await assert.rejects(service.open(owner, { source: 'dialog' }), code('BUSY'))
    resolveSelection(null); assert.deepEqual(await pending, { status: 'cancelled' })
    assert.ok(await service.snapshot(owner, { handle: first.connection.handle }))
    assert.ok(await service.snapshot(owner, { handle: second.connection.handle }))
  } finally { await database.close() }
})

test('IPC 결과는 잘못된 ID·경로·stack을 반사하지 않고 안전한 추적 ID를 발급한다', async () => {
  const denied = await workspaceResult({ requestId: 'private-path' }, false, () => { throw new Error('should not execute') })
  assert.equal(denied.error.code, 'ACCESS_DENIED'); assert.notEqual(denied.requestId, 'private-path')
  const malformed = await workspaceResult({ requestId: 'private-path', payload: {} }, true, () => null)
  assert.equal(malformed.error.code, 'INVALID_REQUEST')
  const requestId = randomUUID()
  const failed = await workspaceResult({ requestId, payload: {} }, true, () => { throw new Error('/private/secret/path') })
  assert.equal(failed.requestId, requestId); assert.equal(failed.error.message.includes('private'), false)
})

async function saveFixture(t, historyFailure = false) {
  const f = await fixture(t)
  const database = await openPersonalDatabase({ userData: path.join(f.directory, 'save-profile'), appVersion: '0.1.0' })
  t.after(() => database.close())
  const { WorkspaceWriter } = require('../dist-electron/electron/workspace-writer.cjs')
  const writer = await WorkspaceWriter.open(path.join(f.directory, 'save-profile'))
  const supplied = historyFailure ? { ...database, personal: { ...database.personal, recordHistory: async () => { throw Error('private database failure') } } } : database
  const owner = { windowId: 91, frame: {} }
  const service = new WorkspaceService(supplied, async () => f.selected, () => true, writer)
  const opened = await service.open(owner, { source: 'dialog' })
  const apiDocument = opened.snapshot.apis[0], api = JSON.parse(apiDocument.json)
  api.url = '{{baseUrl}}/saved-through-service'
  const payload = { handle: opened.connection.handle, operationId: randomUUID(), expectedRevision: opened.snapshot.revision, selectedPresetId: api.defaultPresetId,
    changes: [{ action: 'put', kind: 'api', id: api.id, expectedHash: apiDocument.hash, json: JSON.stringify(api) }] }
  return { ...f, database, writer, owner, service, opened, api, payload }
}

test('Main 파일 저장·상태 조회·SQLite 이력·재열기에서 현재 API/선택 세트 문맥이 일치한다', async t => {
  const f = await saveFixture(t)
  f.payload.selectedPresetId = f.api.presets.find(preset => preset.id !== f.api.defaultPresetId).id
  assert.notEqual(f.payload.selectedPresetId, f.api.defaultPresetId)
  const result = await f.service.commit(f.owner, f.payload)
  assert.equal(result.history, 'recorded')
  const reopened = await f.service.snapshot(f.owner, { handle: f.payload.handle })
  assert.equal(reopened.revision, result.revision)
  assert.equal(JSON.parse(reopened.apis.find(document => document.id === f.api.id).json).url, f.api.url)
  const scope = { localFolderId: f.opened.connection.localFolderId, workspaceId: f.opened.connection.workspaceId }
  const history = await f.database.personal.history({ scope, apiId: f.api.id })
  assert.equal(history.items.length, 1)
  const entry = await f.database.personal.historyEntry({ scope, apiId: f.api.id, historyId: history.items[0].id })
  const json = JSON.parse(entry.json)
  assert.equal(json.common.url, f.api.url)
  assert.equal(json.selectedPreset.id, f.payload.selectedPresetId)
  assert.deepEqual(await f.service.commit(f.owner, f.payload), result)
  assert.equal((await f.database.personal.history({ scope, apiId: f.api.id })).items.length, 1)
  assert.deepEqual(await f.service.commitStatus(f.owner, { handle: f.payload.handle, operationId: f.payload.operationId }), { status: 'committed', result })
})

test('다른 창·잘못된 선택 세트·API 생성/다중 변경·다른 세트 덮어쓰기를 거부', async t => {
  const f = await saveFixture(t)
  await assert.rejects(f.service.commit({ ...f.owner, frame: {} }, f.payload), code('WORKSPACE_NOT_OPEN'))
  await assert.rejects(f.service.commit(f.owner, { ...f.payload, selectedPresetId: randomUUID() }), code('INVALID_REQUEST'))
  await assert.rejects(f.service.commit(f.owner, { ...f.payload, changes: [f.payload.changes[0], f.payload.changes[0]] }), code('INVALID_REQUEST'))
  await assert.rejects(f.service.commit(f.owner, { ...f.payload, changes: [{ ...f.payload.changes[0], expectedHash: null }] }), code('INVALID_REQUEST'))
  const candidate = JSON.parse(f.payload.changes[0].json)
  const other = candidate.presets.find(preset => preset.id !== f.payload.selectedPresetId)
  assert.ok(other)
  other.name = 'not selected'
  await assert.rejects(f.service.commit(f.owner, { ...f.payload, changes: [{ ...f.payload.changes[0], json: JSON.stringify(candidate) }] }), code('INVALID_REQUEST'))
  assert.equal((await readWorkspaceSnapshot(f.root)).revision, f.opened.snapshot.revision)
})

test('비밀 참조의 리터럴 치환과 다른 세트 값 변경을 Main에서 다시 거부', async t => {
  const f = await saveFixture(t)
  const candidate = JSON.parse(f.payload.changes[0].json)
  const selected = candidate.presets.find(preset => preset.id === f.payload.selectedPresetId)
  const channels = ['path', 'query', 'headers', 'multipart']
  let changed = false
  for (const channel of channels) {
    const secret = Object.entries(selected.values[channel]).find(([, cell]) => cell.secretRef)
    if (secret) { selected.values[channel][secret[0]] = { enabled: secret[1].enabled, value: 'private-token-must-not-persist' }; changed = true; break }
  }
  assert.equal(changed, true)
  await assert.rejects(f.service.commit(f.owner, { ...f.payload, changes: [{ ...f.payload.changes[0], json: JSON.stringify(candidate) }] }), code('INVALID_REQUEST'))
  assert.equal((await readWorkspaceSnapshot(f.root)).revision, f.opened.snapshot.revision)
})

test('개인 이력 실패를 파일 실패로 바꾸지 않고 중복 저장도 파일/이력을 반복하지 않는다', async t => {
  const f = await saveFixture(t, true)
  const result = await f.service.commit(f.owner, f.payload)
  assert.equal(result.history, 'failed')
  assert.equal((await readWorkspaceSnapshot(f.root)).revision, result.revision)
  assert.deepEqual(await f.service.commit(f.owner, f.payload), result)
  const other = JSON.parse(f.payload.changes[0].json)
  const selected = other.presets.find(preset => preset.id !== f.payload.selectedPresetId)
  assert.ok(selected)
  await assert.rejects(f.service.commit(f.owner, { ...f.payload, selectedPresetId: selected.id }), code('OPERATION_ID_REUSED'))
})

test('외부 변경 충돌은 파일·개인 이력을 갱신하지 않는다', async t => {
  const f = await saveFixture(t)
  const target = path.join(f.root.canonicalPath, 'apis', `${f.api.id}.json`)
  const external = { ...JSON.parse(await readFile(target, 'utf8')), url: '/external-edit' }
  await writeFile(target, JSON.stringify(external))
  await assert.rejects(f.service.commit(f.owner, f.payload), code('FILE_CONFLICT'))
  assert.equal(await readFile(target, 'utf8'), JSON.stringify(external))
  assert.equal((await f.database.personal.history({ scope: { localFolderId: f.opened.connection.localFolderId, workspaceId: f.opened.connection.workspaceId }, apiId: f.api.id })).items.length, 0)
})

test('Main 종료 대기는 진행 중 파일 교체·개인 이력 처리가 끝날 때까지 기다린다', async t => {
  const f = await saveFixture(t), rename = fs.rename
  let entered, resume
  const reached = new Promise(resolve => { entered = resolve }), paused = new Promise(resolve => { resume = resolve })
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(f.root.canonicalPath, 'apis', `${f.api.id}.json`)) { entered(); await paused }
    return rename(from, to)
  })
  const saving = f.service.commit(f.owner, f.payload)
  await reached
  let drained = false
  const waiting = f.service.drain().then(() => { drained = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(drained, false)
  f.service.releaseOwner(f.owner.windowId)
  resume()
  assert.equal((await saving).history, 'recorded')
  await waiting
  assert.equal(drained, true)
  await assert.rejects(f.service.commitStatus(f.owner, { handle: f.payload.handle, operationId: f.payload.operationId }), code('WORKSPACE_NOT_OPEN'))
})
