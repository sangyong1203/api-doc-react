import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const require = createRequire(import.meta.url)
const { WorkspaceWriter } = require('../dist-electron/electron/workspace-writer.cjs')
const { selectWorkspaceRoot, createWorkspaceFiles, readWorkspaceSnapshot } = require('../dist-electron/electron/workspace-files.cjs')
const { contentHash, stableJson, serializeWorkspaceDocument } = require('../dist-electron/electron/workspace-write-files.cjs')
const { WorkspaceWriteJournal, JOURNAL_LIMITS } = require('../dist-electron/electron/workspace-write-journal.cjs')
const expectCode = expected => error => { assert.equal(error.code, expected); return true }

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'apidoc-file-commit-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let workspace = path.join(directory, 'workspace'), userData = path.join(directory, 'profile')
  await mkdir(workspace)
  const root = await selectWorkspaceRoot(workspace)
  workspace = root.canonicalPath
  const initial = await createWorkspaceFiles(root, 'original')
  const scope = { root, localFolderId: randomUUID(), workspaceId: initial.workspace.id }
  const writer = await WorkspaceWriter.open(userData)
  userData = await fs.realpath(userData)
  const request = { operationId: randomUUID(), expectedRevision: initial.revision, changes: [{ action: 'put', kind: 'workspace', id: scope.workspaceId, expectedHash: initial.workspace.hash, json: JSON.stringify({ ...JSON.parse(initial.workspace.json), name: 'changed' }) }] }
  const journalFile = operationId => path.join(userData, 'workspace-writes', `${scope.localFolderId}-${operationId}.json`)
  return { directory, workspace, userData, scope, writer, request, initial, journalFile }
}
function multi(f) {
  const id = randomUUID()
  const environment = { formatVersion: 1, id, name: 'local', variables: [{ id: randomUUID(), name: 'counter', enabled: true, value: '0' }] }
  const manifest = JSON.parse(f.request.changes[0].json)
  manifest.environmentIds = [id]
  return { ...f.request, changes: [
    { action: 'put', kind: 'environment', id, expectedHash: null, json: JSON.stringify(environment) },
    { ...f.request.changes[0], json: JSON.stringify(manifest) },
  ] }
}
async function crash(f, request, point, recovery) {
  const script = `
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const { WorkspaceWriter } = require(process.argv[1]);
    const input = JSON.parse(process.argv[2]);
    const kill = () => process.kill(process.pid, 'SIGKILL');
    const rename = fs.rename, link = fs.link;
    fs.rename = async (from, to) => {
      const json = to.endsWith(input.request.operationId + '.json') ? JSON.parse(await fs.readFile(from, 'utf8')) : null;
      if (input.point === 'before-terminal' && json?.status === 'committed') { kill(); }
      await rename(from, to);
      if (input.point === 'prepared' && json?.status === 'pending' || input.point === 'terminal' && json?.status === 'committed' || input.point === 'manifest' && to === path.join(input.scope.root.canonicalPath, 'workspace.json')) { kill(); }
    };
    fs.link = async (from, to) => { await link(from, to); if (input.point === 'new-file' && to.includes(path.sep + 'environments' + path.sep)) { kill(); } };
    WorkspaceWriter.open(input.userData).then(async writer => {
      if (input.recovery) { await writer.recover(input.scope, input.request.operationId, input.recovery); }
      else { await writer.commit(input.scope, input.request); }
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `
  const child = spawn(process.execPath, ['-e', script, path.resolve('dist-electron/electron/workspace-writer.cjs'), JSON.stringify({ scope: f.scope, userData: f.userData, request, point, recovery })], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  const [code, signal] = await once(child, 'exit')
  assert.equal(code, null, stderr)
  assert.equal(signal, 'SIGKILL', stderr)
}

test('단일 파일 저장: 실제 hash/revision·결정적 JSON·다시 실행한 상태 조회·원문 없는 완료 기록', async t => {
  const f = await fixture(t)
  const result = await f.writer.commit(f.scope, f.request)
  const saved = await readWorkspaceSnapshot(f.scope.root)
  assert.equal(result.revision, saved.revision)
  assert.equal(result.documents[0].hash, saved.workspace.hash)
  assert.equal(saved.workspace.json, serializeWorkspaceDocument('workspace', JSON.parse(f.request.changes[0].json)))
  const journal = JSON.parse(await readFile(f.journalFile(f.request.operationId), 'utf8'))
  assert.equal(journal.status, 'committed')
  assert.equal('changes' in journal, false)
  assert.equal('base' in journal, false)
  const reopened = await WorkspaceWriter.open(f.userData)
  assert.deepEqual(await reopened.status(f.scope, f.request.operationId), { status: 'committed', result })
  assert.equal((await lstat(f.journalFile(f.request.operationId))).mode & 0o077, 0)
  assert.deepEqual((await readdir(f.workspace)).sort(), ['apis', 'environments', 'workspace.json'])
})

test('동일 의미의 중복 작업은 재쓰기하지 않고 다른 내용·기준 재사용은 거부', async t => {
  const f = await fixture(t)
  const result = await f.writer.commit(f.scope, f.request)
  const before = await lstat(path.join(f.workspace, 'workspace.json'))
  const same = structuredClone(f.request)
  same.changes[0].json = stableJson(JSON.parse(same.changes[0].json))
  assert.deepEqual(await f.writer.commit(f.scope, same), result)
  assert.equal((await lstat(path.join(f.workspace, 'workspace.json'))).mtimeMs, before.mtimeMs)
  same.changes[0].json = JSON.stringify({ ...JSON.parse(same.changes[0].json), name: 'different' })
  await assert.rejects(f.writer.commit(f.scope, same), expectCode('OPERATION_ID_REUSED'))
  assert.equal((await f.writer.status(f.scope, randomUUID())).status, 'unknown')
})

test('다중 파일 생성·삭제는 최종 manifest 관계를 검사하고 같은 내용의 저장은 파일을 건드리지 않는다', async t => {
  const f = await fixture(t), request = multi(f)
  await f.writer.commit(f.scope, request)
  const snapshot = await readWorkspaceSnapshot(f.scope.root)
  assert.equal(snapshot.environments.length, 1)
  assert.equal(JSON.parse(snapshot.environments[0].json).variables[0].value, '0')
  const stat = await lstat(path.join(f.workspace, 'workspace.json'))
  await f.writer.commit(f.scope, { operationId: randomUUID(), expectedRevision: snapshot.revision, changes: [{ action: 'put', kind: 'workspace', id: f.scope.workspaceId, expectedHash: snapshot.workspace.hash, json: snapshot.workspace.json }] })
  assert.equal((await lstat(path.join(f.workspace, 'workspace.json'))).mtimeMs, stat.mtimeMs)
  await f.writer.commit(f.scope, { operationId: randomUUID(), expectedRevision: snapshot.revision, changes: [
    { action: 'delete', kind: 'environment', id: snapshot.environments[0].id, expectedHash: snapshot.environments[0].hash },
    { ...f.request.changes[0], expectedHash: snapshot.workspace.hash },
  ] })
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).environments.length, 0)
})

test('다른 writer 인스턴스도 같은 폴더에서 직렬 처리해 오래된 기준의 두 번째 저장을 거부', async t => {
  const f = await fixture(t), writer2 = await WorkspaceWriter.open(f.userData)
  const second = { ...f.request, operationId: randomUUID() }
  const results = await Promise.allSettled([f.writer.commit(f.scope, f.request), writer2.commit(f.scope, second)])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[1].reason.code, 'FILE_CONFLICT')
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, results[0].value.revision)
})

test('stale revision·기대 해시·중복 대상·manifest ID 변경·manifest 삭제·경로 입력 거부', async t => {
  const f = await fixture(t)
  const cases = [
    [{ ...f.request, expectedRevision: contentHash('old') }, 'FILE_CONFLICT'],
    [{ ...f.request, changes: [{ ...f.request.changes[0], expectedHash: null }] }, 'FILE_CONFLICT'],
    [{ ...f.request, changes: [f.request.changes[0], f.request.changes[0]] }, 'INVALID_REQUEST'],
    [{ ...f.request, changes: [{ ...f.request.changes[0], id: randomUUID() }] }, 'INVALID_REQUEST'],
    [{ ...f.request, changes: [{ action: 'delete', kind: 'workspace', id: f.scope.workspaceId, expectedHash: f.initial.workspace.hash }] }, 'INVALID_REQUEST'],
    [{ ...f.request, path: '/outside' }, 'INVALID_REQUEST'],
  ]
  for (const [input, expected] of cases) { await assert.rejects(f.writer.commit(f.scope, input), expectCode(expected)) }
  await assert.rejects(f.writer.commit(f.scope, { ...f.request, changes: [multi(f).changes[0]] }), expectCode('DOCUMENT_INVALID'))
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, f.initial.revision)
  assert.deepEqual(await f.writer.pending(f.scope), [])
})

for (const nativeCode of ['EACCES', 'ENOSPC', 'EBUSY']) {
  test(`${nativeCode} 파일 교체 실패: 원본 보존·실패 상태 기록·자동 재쓰기 없음`, async t => {
    const f = await fixture(t), rename = fs.rename
    t.mock.method(fs, 'rename', async (from, to) => { if (to === path.join(f.workspace, 'workspace.json')) { throw Object.assign(new Error('private path/secret'), { code: nativeCode }) }; return rename(from, to) })
    await assert.rejects(f.writer.commit(f.scope, f.request), expectCode('FILE_WRITE_FAILED'))
    assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, f.initial.revision)
    const status = await f.writer.status(f.scope, f.request.operationId)
    assert.equal(status.status, 'failed'); assert.equal(status.error.code, 'FILE_WRITE_FAILED'); assert.equal(status.error.message.includes('secret'), false)
    await assert.rejects(f.writer.commit(f.scope, f.request), expectCode('FILE_WRITE_FAILED'))
    assert.equal((await readdir(f.workspace)).some(name => name.endsWith('.tmp')), false)
  })
}

test('두 번째 파일 교체 실패는 먼저 생성한 파일도 원복하고 미완료 기록을 남기지 않는다', async t => {
  const f = await fixture(t), request = multi(f), rename = fs.rename
  t.mock.method(fs, 'rename', async (from, to) => { if (to === path.join(f.workspace, 'workspace.json')) { throw Object.assign(new Error('locked'), { code: 'EBUSY' }) }; return rename(from, to) })
  await assert.rejects(f.writer.commit(f.scope, request), expectCode('FILE_WRITE_FAILED'))
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, f.initial.revision)
  assert.deepEqual(await readdir(path.join(f.workspace, 'environments')), [])
  assert.deepEqual(await f.writer.pending(f.scope), [])
})

test('저널 기록 공간 부족은 공유 파일을 전혀 수정하지 않는다', async t => {
  const f = await fixture(t), open = fs.open
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args)
    if (String(file).includes('.journal-') && args[0] === 'wx') { handle.writeFile = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) } }
    return handle
  })
  await assert.rejects(f.writer.commit(f.scope, f.request), expectCode('FILE_WRITE_FAILED'))
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, f.initial.revision)
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'unknown')
})

for (const point of ['prepared', 'new-file', 'manifest', 'before-terminal', 'terminal']) {
  test(`실제 프로세스 ${point} 직후 강제 종료: 재실행 후 상태 조회·완료 복구`, async t => {
    const f = await fixture(t), request = multi(f)
    await crash(f, request, point)
    const writer = await WorkspaceWriter.open(f.userData)
    const status = await writer.status(f.scope, request.operationId)
    if (point === 'terminal') {
      assert.equal(status.status, 'committed')
      assert.deepEqual(await writer.pending(f.scope), [])
    } else {
      assert.equal(status.status, 'pending')
      await assert.rejects(writer.commit(f.scope, { ...request, operationId: randomUUID() }), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
      const recovered = await writer.recover(f.scope, request.operationId, 'complete')
      assert.equal(recovered.status, 'committed')
      assert.deepEqual(await writer.recover(f.scope, request.operationId, 'complete'), recovered)
    }
    const snapshot = await readWorkspaceSnapshot(f.scope.root)
    assert.equal(snapshot.environments.length, 1)
    assert.equal(JSON.parse(snapshot.workspace.json).name, 'changed')
    assert.equal((await readdir(f.workspace)).some(name => name.endsWith('.tmp')), false)
  })
}

test('부분 공개 후 원본 복구 중에도 강제 종료·재실행하여 원본 바이트로 복구', async t => {
  const f = await fixture(t), request = multi(f)
  await crash(f, request, 'manifest')
  await crash(f, request, 'manifest', 'rollback')
  const writer = await WorkspaceWriter.open(f.userData)
  assert.equal((await writer.status(f.scope, request.operationId)).status, 'pending')
  assert.equal((await writer.recover(f.scope, request.operationId, 'rollback')).status, 'failed')
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, f.initial.revision)
  assert.equal(await readFile(path.join(f.workspace, 'workspace.json'), 'utf8'), f.initial.workspace.json)
})

test('완료 기록 저장 실패는 파일 성공을 실패로 바꾸어 재시도하지 않고 복구 대상으로 보존', async t => {
  const f = await fixture(t), rename = fs.rename
  const mocked = t.mock.method(fs, 'rename', async (from, to) => {
    if (to === f.journalFile(f.request.operationId) && JSON.parse(await readFile(from, 'utf8')).status === 'committed') { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) }
    return rename(from, to)
  })
  await assert.rejects(f.writer.commit(f.scope, f.request), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'pending')
  assert.equal(JSON.parse((await readWorkspaceSnapshot(f.scope.root)).workspace.json).name, 'changed')
  mocked.mock.restore()
  assert.equal((await f.writer.recover(f.scope, f.request.operationId, 'complete')).status, 'committed')
})

test('저장/복구 전 외부 변경은 제3의 파일을 보존하고 복구 대기 유지', async t => {
  const f = await fixture(t), request = multi(f)
  await crash(f, request, 'prepared')
  const file = path.join(f.workspace, 'workspace.json')
  const external = JSON.stringify({ ...JSON.parse(f.initial.workspace.json), name: 'external editor' })
  await writeFile(file, external)
  await assert.rejects(f.writer.recover(f.scope, request.operationId, 'rollback'), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
  await assert.rejects(f.writer.recover(f.scope, request.operationId, 'complete'), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
  assert.equal(await readFile(file, 'utf8'), external)
  assert.equal((await f.writer.status(f.scope, request.operationId)).status, 'pending')
})

test('임시 파일 쓰기 중 외부 수정도 교체/자동 원복하지 않는다', async t => {
  const f = await fixture(t), open = fs.open
  const external = JSON.stringify({ ...JSON.parse(f.initial.workspace.json), name: 'external concurrent' })
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args)
    if (String(file).includes('.apidoc-write-') && args[0] === 'wx') {
      const original = handle.sync.bind(handle)
      handle.sync = async () => { await original(); await writeFile(path.join(f.workspace, 'workspace.json'), external) }
    }
    return handle
  })
  await assert.rejects(f.writer.commit(f.scope, f.request), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
  assert.equal(await readFile(path.join(f.workspace, 'workspace.json'), 'utf8'), external)
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'pending')
})

test('손상 저널·다른 manifest·파일 링크를 따라 쓰지 않는다', async t => {
  const f = await fixture(t), request = multi(f)
  await crash(f, request, 'prepared')
  const journalFile = f.journalFile(request.operationId)
  const original = await readFile(journalFile, 'utf8')
  const data = JSON.parse(original); data.changes[0].before = 'invalid-base64'
  await writeFile(journalFile, JSON.stringify(data))
  await assert.rejects(f.writer.pending(f.scope), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
  await writeFile(journalFile, original)
  await assert.rejects(f.writer.recover({ ...f.scope, workspaceId: randomUUID() }, request.operationId, 'complete'), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
  const outside = path.join(f.directory, 'outside.json')
  await writeFile(outside, f.initial.workspace.json)
  await rm(path.join(f.workspace, 'workspace.json'))
  await fs.symlink(outside, path.join(f.workspace, 'workspace.json'))
  await assert.rejects(f.writer.recover(f.scope, request.operationId, 'complete'), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
  assert.equal(await readFile(outside, 'utf8'), f.initial.workspace.json)
})

test('완료 상태 보관 만료만 정리하고 미완료·미래 기록은 보존', async t => {
  const f = await fixture(t)
  await f.writer.commit(f.scope, f.request)
  const file = f.journalFile(f.request.operationId), data = JSON.parse(await readFile(file, 'utf8'))
  data.updatedAt = Date.now() - JOURNAL_LIMITS.retentionMs - 1000
  await writeFile(file, JSON.stringify(data))
  const journal = await WorkspaceWriteJournal.open(f.userData)
  await journal.prune(f.scope)
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'unknown')
  data.updatedAt = Date.now() + JOURNAL_LIMITS.retentionMs
  await writeFile(file, JSON.stringify(data))
  const snapshot = await readWorkspaceSnapshot(f.scope.root)
  const next = { ...f.request, operationId: randomUUID(), expectedRevision: snapshot.revision, changes: [{ ...f.request.changes[0], expectedHash: snapshot.workspace.hash }] }
  await crash(f, next, 'prepared')
  await journal.prune(f.scope)
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'committed')
  assert.deepEqual(await f.writer.pending(f.scope), [next.operationId])
})

test('복구 저장소를 공유 폴더 내부에 둘 수 없다', async t => {
  const f = await fixture(t), writer = await WorkspaceWriter.open(path.join(f.workspace, 'private'))
  await assert.rejects(writer.commit(f.scope, f.request), expectCode('PATH_NOT_ALLOWED'))
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, f.initial.revision)
})

test('디스크 부족으로 임시 파일 일부만 썼다면 원본을 보존하고 자신의 부분 후보만 정리', async t => {
  const f = await fixture(t), open = fs.open
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args)
    if (String(file).includes('.apidoc-write-') && args[0] === 'wx') {
      const write = handle.writeFile.bind(handle)
      handle.writeFile = async data => { await write(data.slice(0, 17)); throw Object.assign(new Error('full'), { code: 'ENOSPC' }) }
    }
    return handle
  })
  await assert.rejects(f.writer.commit(f.scope, f.request), expectCode('FILE_WRITE_FAILED'))
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, f.initial.revision)
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'failed')
  assert.equal((await readdir(f.workspace)).some(name => name.endsWith('.tmp')), false)
})

test('관리 폴더가 없던 빈 공간도 신규 문서를 저장하며 실패 시 빈 폴더만 남길 수 있다', async t => {
  const f = await fixture(t), request = multi(f)
  await rm(path.join(f.workspace, 'environments'), { recursive: true })
  await f.writer.commit(f.scope, request)
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).environments.length, 1)
})

test('쓰기 중인 상태 조회는 pending을 반환하고 완료 후 확정 상태로 바뀐다', async t => {
  const f = await fixture(t), rename = fs.rename
  let entered, resume
  const reached = new Promise(resolve => { entered = resolve })
  const paused = new Promise(resolve => { resume = resolve })
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(f.workspace, 'workspace.json')) { entered(); await paused }
    return rename(from, to)
  })
  const writing = f.writer.commit(f.scope, f.request)
  await reached
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'pending')
  resume(); await writing
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'committed')
})

test('임시 파일이 외부 내용으로 교체되면 목적 파일과 외부 임시 파일 모두 보존', async t => {
  const f = await fixture(t), open = fs.open
  let temporary
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args)
    if (String(file).includes('.apidoc-write-') && args[0] === 'wx') {
      temporary = file
      const sync = handle.sync.bind(handle)
      handle.sync = async () => { await sync(); await fs.unlink(file); await writeFile(file, 'external temporary content') }
    }
    return handle
  })
  await assert.rejects(f.writer.commit(f.scope, f.request), expectCode('WORKSPACE_RECOVERY_REQUIRED'))
  assert.equal((await readWorkspaceSnapshot(f.scope.root)).revision, f.initial.revision)
  assert.equal(await readFile(temporary, 'utf8'), 'external temporary content')
})

test('단일 payload와 복구 기록 예산 초과는 공유 파일 변경 전에 거부', async t => {
  const f = await fixture(t)
  await assert.rejects(f.writer.commit(f.scope, { ...f.request, changes: [{ ...f.request.changes[0], json: ' '.repeat(8 * 1024 * 1024 + 1) }] }), expectCode('PAYLOAD_TOO_LARGE'))
  const journal = await WorkspaceWriteJournal.open(f.userData)
  await f.writer.commit(f.scope, f.request)
  const record = JSON.parse(await readFile(f.journalFile(f.request.operationId), 'utf8'))
  const reservation = await fs.open(path.join(f.userData, 'workspace-writes', '.orphan-candidate.tmp'), 'wx')
  try { await reservation.truncate(JOURNAL_LIMITS.totalBytes) } finally { await reservation.close() }
  await assert.rejects(journal.write(f.scope, record), expectCode('PAYLOAD_TOO_LARGE'))
  assert.equal((await f.writer.status(f.scope, f.request.operationId)).status, 'committed')
})

test('공유 문서 직렬화는 실제 v1 스키마 속성 순서·UUID 맵 정렬·배열 순서·값을 보존', async () => {
  const schema = JSON.parse(await readFile('../doc/storage-v1.schema.json', 'utf8'))
  const samples = JSON.parse(await readFile('../doc/storage-v1.samples.json', 'utf8'))
  const files = samples.valid.find(sample => sample.name === 'main').files
  const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)])) : value
  function checkOrder(value, definition) {
    if (definition.$ref) { return checkOrder(value, schema.definitions[definition.$ref.split('/').at(-1)]) }
    if (Array.isArray(value)) { for (const child of value) { checkOrder(child, definition.items) }; return }
    if (value === null || typeof value !== 'object') { return }
    if (definition.oneOf && !definition.properties) { return checkOrder(value, definition.oneOf.find(branch => branch.type === 'object' || branch.$ref)) }
    const keys = Object.keys(value)
    const expected = definition.properties ? Object.keys(definition.properties).filter(key => Object.hasOwn(value, key)) : [...keys].sort()
    assert.deepEqual(keys, expected)
    for (const [key, child] of Object.entries(value)) {
      const childDefinition = definition.properties?.[key] ?? definition.additionalProperties
      if (childDefinition && typeof childDefinition === 'object') { checkOrder(child, childDefinition) }
    }
  }
  for (const [relative, document] of Object.entries(files)) {
    const kind = relative === 'workspace.json' ? 'workspace' : relative.startsWith('apis/') ? 'api' : 'environment'
    const serialized = serializeWorkspaceDocument(kind, reverse(document))
    assert.deepEqual(JSON.parse(serialized), document)
    assert.equal(serialized, serializeWorkspaceDocument(kind, document))
    assert.ok(serialized.endsWith('\n') && !serialized.includes('\r\n'))
    checkOrder(JSON.parse(serialized), schema.definitions[kind])
  }
})

test('실제 API 파일 저장은 다른 세트/환경/manifest를 보존하고 비선택 세트 오류도 거부', async t => {
  const f = await fixture(t)
  const samples = JSON.parse(await readFile('../doc/storage-v1.samples.json', 'utf8'))
  const files = samples.valid.find(sample => sample.name === 'main').files
  for (const [relative, data] of Object.entries(files)) {
    const file = path.join(f.workspace, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(data))
  }
  const before = await readWorkspaceSnapshot(f.scope.root)
  const scope = { ...f.scope, workspaceId: before.workspace.id }
  const api = before.apis.find(document => JSON.parse(document.json).presets.length > 1)
  assert.ok(api)
  const edited = { ...JSON.parse(api.json), url: '{{baseUrl}}/saved-by-file-layer' }
  await f.writer.commit(scope, { operationId: randomUUID(), expectedRevision: before.revision, changes: [{ action: 'put', kind: 'api', id: api.id, expectedHash: api.hash, json: JSON.stringify(edited) }] })
  const saved = await readWorkspaceSnapshot(scope.root)
  const savedApi = saved.apis.find(document => document.id === api.id)
  assert.deepEqual(JSON.parse(savedApi.json), edited)
  assert.equal(saved.workspace.hash, before.workspace.hash)
  assert.deepEqual(saved.environments, before.environments)
  assert.deepEqual(saved.apis.filter(document => document.id !== api.id), before.apis.filter(document => document.id !== api.id))
  const invalid = structuredClone(edited)
  invalid.presets[1].values.query[randomUUID()] = { enabled: true, value: 'unknown field' }
  await assert.rejects(f.writer.commit(scope, { operationId: randomUUID(), expectedRevision: saved.revision, changes: [{ action: 'put', kind: 'api', id: api.id, expectedHash: savedApi.hash, json: JSON.stringify(invalid) }] }), expectCode('DOCUMENT_INVALID'))
  assert.equal((await readWorkspaceSnapshot(scope.root)).revision, saved.revision)
})
