import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const { openPersonalDatabaseConnection } = require('../dist-electron/electron/personal-database-schema.cjs')
const { PersonalDataStore, historyIdsToPrune } = require('../dist-electron/electron/personal-data-store.cjs')
const { openPersonalDatabase } = require('../dist-electron/electron/personal-database.cjs')
const { validatePreferences, validateDraft, validateHistory, PERSONAL_LIMITS } = require('../dist-electron/electron/personal-data-validation.cjs')
const hash = `sha256:${'a'.repeat(64)}`
const stringify = value => JSON.stringify(value)
const errorCode = code => error => { assert.equal(error.code, code); return true }

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'apidoc-personal-data-'))
  let now = new Date('2030-01-01T00:00:00.000Z')
  const database = openPersonalDatabaseConnection(directory, '0.1.0')
  const store = new PersonalDataStore(database, () => now)
  t.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  const scope = store.execute('rememberWorkspace', { canonicalPath: path.join(directory, 'workspace'), pathKey: path.join(directory, 'workspace'), workspaceId: randomUUID(), displayName: '개인 작업 공간' })
  return { store, database, directory, scope, setNow: value => { now = new Date(value) } }
}
function sample() {
  const ids = Object.fromEntries(['api', 'preset', 'path', 'query', 'header', 'root', 'number', 'boolean', 'file'].map(key => [key, randomUUID()]))
  const field = (key, name, type, extra = {}) => ({ id: ids[key], name, type, required: false, description: '', ...extra })
  const common = {
    method: 'POST', url: '{{baseUrl}}/robots/{id}',
    request: {
      path: [field('path', 'id', 'string', { required: true })],
      query: [field('query', 'limit', 'number', { arrayFormat: 'repeat' })],
      headers: [field('header', 'x-test', 'string')],
      body: { format: 'json', json: [field('root', '$', 'object', { parentId: null }), field('number', 'count', 'number', { parentId: ids.root }), field('boolean', 'enabled', 'boolean', { parentId: ids.root })], multipart: [field('file', 'upload', 'file')] },
    },
    response: { success: [], errors: [] }, documentation: { description: '', requestExample: '', responseExample: '' },
  }
  const values = {
    path: { [ids.path]: { enabled: true, value: 'robot-1' } }, query: { [ids.query]: { enabled: true, value: '0' } }, headers: { [ids.header]: { enabled: false, value: '' } },
    body: { fields: { [ids.number]: '0', [ids.boolean]: 'false' }, enabled: { [ids.root]: true, [ids.number]: true, [ids.boolean]: true } }, multipart: { [ids.file]: { enabled: true } },
  }
  return { ids, common, values, api: { payloadVersion: 1, common }, preset: { payloadVersion: 1, values, rawBodyText: null, bodyView: 'fields' }, history: { payloadVersion: 1, common, selectedPreset: { id: ids.preset, name: '기본 세트', values } } }
}
function draftInput(scope, sample, kind = 'api') {
  return {
    scope, target: kind === 'api' ? { kind, apiId: sample.ids.api } : { kind, apiId: sample.ids.api, presetId: sample.ids.preset },
    editSessionId: randomUUID(), expectedRevision: null, baseRevision: hash,
    json: stringify(kind === 'api' ? sample.api : sample.preset), ...(kind === 'preset' ? { commonJson: stringify(sample.api) } : {}),
  }
}
function keyOf(input) { return { scope: input.scope, target: input.target, editSessionId: input.editSessionId } }
function historyInput(scope, value) { return { scope, apiId: value.ids.api, operationId: randomUUID(), json: stringify(value.history) } }

test('설정 DTO는 허용 키·UUID·탭 중복/상한·버전을 검사하고 크기 초과를 거부한다', () => {
  assert.equal(JSON.parse(validatePreferences('{"payloadVersion":1,"theme":"dark"}', 'app')).theme, 'dark')
  for (const value of [{ payloadVersion: 1, arbitraryKey: 'secret' }, { payloadVersion: 1, theme: 'invalid' }, { payloadVersion: 1, lastWorkspace: { localFolderId: 'invalid', workspaceId: randomUUID() } }]) {
    assert.throws(() => validatePreferences(stringify(value), 'app'), errorCode('INVALID_REQUEST'))
  }
  assert.throws(() => validatePreferences('{"payloadVersion":2}', 'app'), errorCode('DATABASE_VERSION_UNSUPPORTED'))
  const apiId = randomUUID()
  for (const tabs of [[{ apiId, selectedPresetId: null }, { apiId, selectedPresetId: null }], Array.from({ length: 201 }, () => ({ apiId: randomUUID(), selectedPresetId: null }))]) {
    assert.throws(() => validatePreferences(stringify({ payloadVersion: 1, openTabs: tabs }), 'workspace'), errorCode('INVALID_REQUEST'))
  }
  assert.throws(() => validatePreferences(' '.repeat(PERSONAL_LIMITS.preferences + 1), 'app'), errorCode('PAYLOAD_TOO_LARGE'))
  assert.throws(() => validatePreferences('{', 'app'), errorCode('INVALID_REQUEST'))
})

test('설정 CAS는 신규·수정·최대 revision 충돌을 구분하고 실패 시 기존 값을 보존한다', t => {
  const { store, database } = fixture(t)
  const scope = { kind: 'app' }
  assert.equal(store.execute('preferences', { scope }), null)
  const first = store.execute('savePreferences', { scope, expectedRevision: null, json: '{"payloadVersion":1,"theme":"dark"}' })
  assert.equal(first.revision, 0)
  for (const expectedRevision of [null, 1]) { assert.throws(() => store.execute('savePreferences', { scope, expectedRevision, json: '{"payloadVersion":1}' }), errorCode('RECORD_CONFLICT')) }
  assert.deepEqual(store.execute('preferences', { scope }), first)
  assert.equal(store.execute('savePreferences', { scope, expectedRevision: 0, json: '{"payloadVersion":1,"theme":"light"}' }).revision, 1)
  database.prepare('UPDATE app_preferences SET revision = ?').run(Number.MAX_SAFE_INTEGER)
  assert.throws(() => store.execute('savePreferences', { scope, expectedRevision: Number.MAX_SAFE_INTEGER, json: '{"payloadVersion":1}' }), errorCode('RECORD_CONFLICT'))
  assert.throws(() => store.execute('savePreferences', { scope, expectedRevision: -1, json: '{"payloadVersion":1}' }), errorCode('INVALID_REQUEST'))
})

test('같은 workspace ID의 복제 폴더·같은 폴더의 다른 manifest 설정을 분리한다', t => {
  const { store, scope, directory } = fixture(t)
  const link = (folder, workspaceId) => store.execute('rememberWorkspace', { canonicalPath: path.join(directory, folder), pathKey: path.join(directory, folder), workspaceId, displayName: folder })
  const clone = link('clone', scope.workspaceId)
  const replacement = link('workspace', randomUUID())
  assert.notEqual(scope.localFolderId, clone.localFolderId)
  assert.equal(scope.localFolderId, replacement.localFolderId)
  store.execute('savePreferences', { scope: { kind: 'workspace', ...scope }, expectedRevision: null, json: '{"payloadVersion":1}' })
  for (const pair of [clone, replacement]) { assert.equal(store.execute('preferences', { scope: { kind: 'workspace', ...pair } }), null) }
  assert.throws(() => store.execute('savePreferences', { scope: { kind: 'app' }, expectedRevision: null, json: stringify({ payloadVersion: 1, lastWorkspace: { ...scope, localFolderId: randomUUID() } }) }), errorCode('NOT_FOUND'))
})

test('최근 폴더 상한은 목록만 숨기고 초안·공간 연결을 삭제하지 않는다', t => {
  const { store, scope, database, directory, setNow } = fixture(t)
  const draft = draftInput(scope, sample())
  store.execute('saveDraft', draft)
  for (let i = 0; i < 21; i++) {
    setNow(`2030-01-01T00:00:${String(i + 1).padStart(2, '0')}.000Z`)
    store.execute('rememberWorkspace', { canonicalPath: path.join(directory, String(i)), pathKey: path.join(directory, String(i)), workspaceId: randomUUID(), displayName: String(i) })
  }
  assert.equal(database.prepare('SELECT count(*) AS n FROM local_folders WHERE hidden = 0').get().n, 20)
  assert.equal(database.prepare('SELECT count(*) AS n FROM workspace_links').get().n, 22)
  assert.ok(store.execute('draft', keyOf(draft)))
})

test('초안은 미완성 숫자·JSON 원문과 0/false/빈 값·비밀 참조를 보존하고 파일 선택 정보는 거부한다', t => {
  const { store, scope } = fixture(t)
  const value = sample()
  value.preset.rawBodyText = '{ incomplete'
  value.values.query[value.ids.query].value = 'not a number'
  value.values.headers[value.ids.header] = { enabled: true, secretRef: randomUUID() }
  const input = draftInput(scope, value, 'preset')
  store.execute('saveDraft', input)
  const read = JSON.parse(store.execute('draft', keyOf(input)).json)
  assert.equal(read.rawBodyText, '{ incomplete')
  assert.equal(read.values.body.fields[value.ids.number], '0')
  assert.equal(read.values.body.fields[value.ids.boolean], 'false')
  assert.ok(read.values.headers[value.ids.header].secretRef)
  value.values.multipart[value.ids.file].filePath = '/private/selected-file'
  assert.throws(() => store.execute('saveDraft', { ...input, expectedRevision: 0, json: stringify(value.preset) }), errorCode('INVALID_REQUEST'))
  assert.deepEqual(JSON.parse(store.execute('draft', keyOf(input)).json), read)
})

test('초안은 세션별로 보존하며 오래된 revision의 수정·폐기는 새 편집을 지우지 않는다', t => {
  const { store, scope } = fixture(t)
  const value = sample()
  const first = draftInput(scope, value)
  const second = { ...first, editSessionId: randomUUID() }
  store.execute('saveDraft', first); store.execute('saveDraft', second)
  value.api.common.url = ''
  value.api.common.request.query[0].name = ''
  const edited = store.execute('saveDraft', { ...first, expectedRevision: 0, json: stringify(value.api) })
  assert.equal(edited.revision, 1)
  assert.throws(() => store.execute('removeDraft', { ...keyOf(first), expectedRevision: 0 }), errorCode('RECORD_CONFLICT'))
  assert.throws(() => store.execute('saveDraft', { ...first, expectedRevision: 0 }), errorCode('RECORD_CONFLICT'))
  const list = store.execute('drafts', { scope, apiId: value.ids.api })
  assert.equal(list.length, 2); assert.equal('json' in list[0], false)
  store.execute('removeDraft', { ...keyOf(first), expectedRevision: 1 })
  assert.equal(store.execute('draft', keyOf(first)), null)
  assert.ok(store.execute('draft', keyOf(second)))
})

test('필드 중복 ID·부모 누락/순환·다른 명세의 값·파일 값은 거부한다', () => {
  for (const mutate of [
    value => { value.common.request.body.json[1].parentId = randomUUID() },
    value => { value.common.request.body.json[0].parentId = value.ids.root },
    value => { value.common.request.headers[0].id = value.ids.query },
  ]) {
    const value = sample(); mutate(value)
    assert.throws(() => validateDraft(stringify(value.api), 'api'), errorCode('INVALID_REQUEST'))
  }
  const value = sample()
  value.values.query[randomUUID()] = { enabled: false, value: '' }
  assert.throws(() => validateDraft(stringify(value.preset), 'preset', stringify(value.api)), errorCode('INVALID_REQUEST'))
  delete value.values.query[Object.keys(value.values.query).find(id => id !== value.ids.query)]
  value.values.multipart[value.ids.file] = { enabled: true, value: 'file content' }
  assert.throws(() => validateHistory(stringify(value.history), value.ids.api), errorCode('INVALID_REQUEST'))
})

test('저장 이력은 미완성 숫자를 거부하고 비활성 값·부모 아래 값은 보존한다', () => {
  const value = sample()
  value.values.query[value.ids.query].value = 'invalid'
  assert.throws(() => validateHistory(stringify(value.history), value.ids.api), errorCode('INVALID_REQUEST'))
  value.values.query[value.ids.query].enabled = false
  value.values.body.enabled[value.ids.root] = false
  value.values.body.fields[value.ids.number] = 'invalid'
  assert.ok(validateHistory(stringify(value.history), value.ids.api))
})

test('초안 8 MiB 초과는 기존 초안을 보존한다', t => {
  const { store, scope } = fixture(t)
  const value = sample()
  const input = draftInput(scope, value, 'preset')
  const previous = store.execute('saveDraft', input)
  value.preset.rawBodyText = 'x'.repeat(PERSONAL_LIMITS.record)
  assert.throws(() => store.execute('saveDraft', { ...input, expectedRevision: 0, json: stringify(value.preset) }), errorCode('PAYLOAD_TOO_LARGE'))
  assert.equal(store.execute('draft', keyOf(input)).json, previous.json)
})

test('operation 재전송은 키 순서와 무관하게 중복을 막고 다른 내용은 충돌로 처리한다', t => {
  const { store, scope } = fixture(t)
  const value = sample()
  const input = historyInput(scope, value)
  const first = store.execute('recordHistory', input)
  const reordered = { selectedPreset: value.history.selectedPreset, common: value.history.common, payloadVersion: 1 }
  assert.deepEqual(store.execute('recordHistory', { ...input, json: stringify(reordered) }), first)
  value.history.common.url = '/changed'
  assert.throws(() => store.execute('recordHistory', { ...input, json: stringify(value.history) }), errorCode('RECORD_CONFLICT'))
  assert.equal(store.execute('history', { scope, apiId: value.ids.api }).items.length, 1)
})

test('동일 시각의 이력 페이지는 UUID 내림차순이고 다른 공간/API의 커서를 거부한다', t => {
  const { store, scope } = fixture(t)
  const value = sample()
  const entries = Array.from({ length: 5 }, () => store.execute('recordHistory', historyInput(scope, value)))
  const first = store.execute('history', { scope, apiId: value.ids.api, limit: 2 })
  const second = store.execute('history', { scope, apiId: value.ids.api, beforeId: first.nextBeforeId, limit: 2 })
  const third = store.execute('history', { scope, apiId: value.ids.api, beforeId: second.nextBeforeId, limit: 2 })
  assert.equal(third.nextBeforeId, null)
  assert.deepEqual([...first.items, ...second.items, ...third.items].map(row => row.id), entries.map(row => row.id).sort().reverse())
  assert.equal('json' in first.items[0], false)
  const detail = store.execute('historyEntry', { scope, apiId: value.ids.api, historyId: entries[0].id })
  assert.equal(JSON.parse(detail.json).selectedPreset.id, value.ids.preset)
  assert.throws(() => store.execute('history', { scope, apiId: randomUUID(), beforeId: entries[0].id }), errorCode('NOT_FOUND'))
  assert.throws(() => store.execute('historyEntry', { scope, apiId: randomUUID(), historyId: entries[0].id }), errorCode('NOT_FOUND'))
  assert.throws(() => store.execute('history', { scope, apiId: value.ids.api, limit: 101 }), errorCode('INVALID_REQUEST'))
})

test('API별 100건·90일 보관을 적용하되 시계 역행 시 기간 정리와 초안 삭제를 하지 않는다', t => {
  const { store, scope, database, setNow } = fixture(t)
  const value = sample()
  const input = draftInput(scope, value)
  store.execute('saveDraft', input)
  for (let i = 0; i < 102; i++) { store.execute('recordHistory', historyInput(scope, value)) }
  assert.equal(database.prepare('SELECT count(*) AS n FROM api_save_history').get().n, 100)
  setNow('2029-01-01T00:00:00.000Z')
  // 다른 API를 사용해 건수 제한의 영향을 받지 않고 시계 역행 동작을 확인합니다.
  const other = sample()
  store.execute('recordHistory', historyInput(scope, other))
  assert.equal(database.prepare('SELECT count(*) AS n FROM api_save_history').get().n, 101)
  setNow('2030-05-01T00:00:00.000Z')
  store.execute('recordHistory', historyInput(scope, other))
  assert.equal(database.prepare('SELECT count(*) AS n FROM api_save_history').get().n, 1)
  assert.ok(store.execute('draft', keyOf(input)))
})

test('시계 역행으로 새 이력이 보관 정리에 걸리면 삽입과 정리를 함께 롤백한다', t => {
  const { store, scope, database, setNow } = fixture(t)
  const value = sample()
  for (let i = 0; i < 100; i++) { store.execute('recordHistory', historyInput(scope, value)) }
  const before = database.prepare('SELECT id FROM api_save_history ORDER BY id').all()
  setNow('2029-01-01T00:00:00.000Z')
  assert.throws(() => store.execute('recordHistory', historyInput(scope, value)), errorCode('DATABASE_WRITE_FAILED'))
  assert.deepEqual(database.prepare('SELECT id FROM api_save_history ORDER BY id').all(), before)
})

test('전역 512 MiB 정리는 가장 오래된 이력부터 제거하고 API별·공간별 건수는 따로 센다', () => {
  const now = Date.parse('2030-01-01T00:00:00.000Z')
  const rows = Array.from({ length: 65 }, (_, i) => ({ id: String(i), local_folder_id: 'folder', workspace_id: 'workspace', api_id: 'api', saved_at: new Date(now + i).toISOString(), byte_size: 8 * 1024 * 1024 }))
  assert.deepEqual(historyIdsToPrune(rows, now, now), ['0'])
  const byScope = Array.from({ length: 101 }, (_, i) => ({ ...rows[0], id: String(i), byte_size: 1, local_folder_id: i === 100 ? 'clone' : 'folder' }))
  assert.deepEqual(historyIdsToPrune(byScope, now, now), [])
})

test('손상된 개인 DTO는 원문을 반환하지 않고 읽기 오류로 처리한다', t => {
  const { store, database } = fixture(t)
  database.prepare('INSERT INTO app_preferences VALUES (1, 0, 1, ?, ?)').run('{"payloadVersion":1,"secret":"do-not-return"}', '2030-01-01T00:00:00.000Z')
  assert.throws(() => store.execute('preferences', { scope: { kind: 'app' } }), error => {
    assert.equal(error.code, 'DATABASE_UNAVAILABLE'); assert.equal(error.message.includes('do-not-return'), false); return true
  })
})

test('Worker의 실제 저장·재열기·동시 CAS와 요청 오류 이후 후속 작업을 검증한다', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'apidoc-personal-service-'))
  let database
  try {
    database = await openPersonalDatabase({ userData: directory, appVersion: '0.1.0' })
    const scope = { kind: 'app' }
    const input = { scope, expectedRevision: null, json: '{"payloadVersion":1,"theme":"dark"}' }
    const results = await Promise.allSettled([database.personal.savePreferences(input), database.personal.savePreferences(input)])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'RECORD_CONFLICT')
    await assert.rejects(database.personal.savePreferences({ ...input, expectedRevision: 0, json: '{"payloadVersion":1,"extra":"private"}' }), errorCode('INVALID_REQUEST'))
    assert.equal((await database.status()).schemaVersion, 1)
    await database.close()
    database = await openPersonalDatabase({ userData: directory, appVersion: '0.1.0' })
    assert.equal(JSON.parse((await database.personal.preferences({ scope })).json).theme, 'dark')
  } finally { if (database) { await database.close() }
    rmSync(directory, { recursive: true, force: true }) }
})


test('초안 합계 128 MiB 상한에서 새 저장을 거부하고 작은 수정으로 용량을 회수할 수 있다', t => {
  const { store, scope, database } = fixture(t)
  const value = sample()
  const emptyBytes = Buffer.byteLength(stringify(value.api))
  value.api.common.documentation.description = 'x'.repeat(PERSONAL_LIMITS.record - emptyBytes)
  const largeJson = stringify(value.api)
  assert.equal(Buffer.byteLength(largeJson), PERSONAL_LIMITS.record)
  const insert = database.prepare('INSERT INTO drafts VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?)')
  const keys = Array.from({ length: 16 }, () => ({ apiId: randomUUID(), editSessionId: randomUUID() }))
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const key of keys) {
      insert.run(scope.localFolderId, scope.workspaceId, key.apiId, 'api', key.apiId, key.editSessionId, hash, largeJson, PERSONAL_LIMITS.record, '2030-01-01T00:00:00.000Z')
    }
    database.exec('COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
  const input = draftInput(scope, sample())
  assert.throws(() => store.execute('saveDraft', input), errorCode('PAYLOAD_TOO_LARGE'))
  assert.equal(database.prepare('SELECT count(*) AS n FROM drafts').get().n, 16)
  store.execute('saveDraft', { ...input, target: { kind: 'api', apiId: keys[0].apiId }, editSessionId: keys[0].editSessionId, expectedRevision: 0 })
  assert.equal(store.execute('saveDraft', input).revision, 0)
})

test('시작 시 기간 정리는 재실행 전 이력을 정리하고 시계 역행에서는 보존한다', t => {
  const { store, scope, database } = fixture(t)
  const value = sample()
  store.execute('recordHistory', historyInput(scope, value))
  new PersonalDataStore(database, () => new Date('2029-01-01T00:00:00.000Z'))
  assert.equal(database.prepare('SELECT count(*) AS n FROM api_save_history').get().n, 1)
  new PersonalDataStore(database, () => new Date('2031-01-01T00:00:00.000Z'))
  assert.equal(database.prepare('SELECT count(*) AS n FROM api_save_history').get().n, 0)
})


test('API 자신의 ID를 필드 ID로 재사용한 초안은 저장하지 않는다', t => {
  const { store, scope } = fixture(t)
  const value = sample()
  value.common.request.headers[0].id = value.ids.api
  assert.throws(() => store.execute('saveDraft', draftInput(scope, value)), errorCode('INVALID_REQUEST'))
})
