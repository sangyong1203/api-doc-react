import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'

const require = createRequire(import.meta.url)
const { openPersonalDatabaseConnection, PERSONAL_MIGRATION_CHECKSUM, PERSONAL_APPLICATION_ID } = require('../dist-electron/electron/personal-database-schema.cjs')
const { openPersonalDatabase } = require('../dist-electron/electron/personal-database.cjs')
const time = '2026-11-22T00:00:00.000Z'
const json = '{"payloadVersion":1}'
const jsonBytes = Buffer.byteLength(json)

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'apidoc-personal-db-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return { directory, file: path.join(directory, 'personal.sqlite') }
}
function databaseAt(directory) { return openPersonalDatabaseConnection(directory, '0.1.0') }
function seedScope(database, folderId = randomUUID(), workspaceId = randomUUID(), folderPath = '/workspace') {
  database.prepare('INSERT INTO local_folders VALUES (?, ?, ?, ?, ?, ?)').run(folderId, folderPath, folderPath, time, time, 0)
  database.prepare('INSERT INTO workspace_links VALUES (?, ?, ?, ?)').run(folderId, workspaceId, '작업 공간', time)
  return { folderId, workspaceId }
}
function draft(database, scope, { apiId = randomUUID(), sessionId = randomUUID(), targetId = apiId, body = json, byteSize = Buffer.byteLength(body) } = {}) {
  database.prepare('INSERT INTO drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(scope.folderId, scope.workspaceId, apiId, 'api', targetId, sessionId, 0, `sha256:${'a'.repeat(64)}`, 1, body, byteSize, time)
  return { apiId, sessionId }
}

// 모든 검사는 실제 SQLite 파일을 사용하며 DB/원본 파일 보존과 Worker 수명 경계를 확인합니다.
test('v1 초기 생성은 STRICT 7개 테이블·인덱스·migration과 안전한 연결 설정을 구성한다', (t) => {
  const { directory } = fixture(t)
  const database = databaseAt(directory)
  try {
    assert.equal(database.prepare('PRAGMA application_id').get().application_id, PERSONAL_APPLICATION_ID)
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 1)
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    assert.equal(database.prepare('PRAGMA synchronous').get().synchronous, 2)
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
    assert.equal(database.prepare('PRAGMA busy_timeout').get().timeout, 1000)
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM pragma_table_list WHERE name NOT LIKE 'sqlite_%' AND strict = 1").get().n, 7)
    assert.equal(database.prepare('SELECT migration_checksum FROM schema_migrations').get().migration_checksum, PERSONAL_MIGRATION_CHECKSUM)
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all().map(row => row.name), ['drafts_by_api_updated', 'history_by_api_saved'])
    assert.throws(() => database.enableLoadExtension(true))
  } finally { database.close() }
})

test('재열기는 개인 데이터를 보존하고 migration을 중복 생성하지 않는다', (t) => {
  const { directory } = fixture(t)
  let database = databaseAt(directory)
  database.prepare('INSERT INTO app_preferences VALUES (?, ?, ?, ?, ?)').run(1, 0, 1, '{"payloadVersion":1,"theme":"dark"}', time)
  database.close()
  database = databaseAt(directory)
  try {
    assert.equal(JSON.parse(database.prepare('SELECT json FROM app_preferences').get().json).theme, 'dark')
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 1)
  } finally { database.close() }
})

test('폴더 복제본·다른 workspace·편집 세션의 초안 키와 FK를 구분한다', (t) => {
  const { directory } = fixture(t)
  const database = databaseAt(directory)
  try {
    const first = seedScope(database)
    const clone = seedScope(database, randomUUID(), first.workspaceId, '/clone')
    const replaced = { ...first, workspaceId: randomUUID() }
    database.prepare('INSERT INTO workspace_links VALUES (?, ?, ?, ?)').run(replaced.folderId, replaced.workspaceId, '새 공간', time)
    const key = draft(database, first)
    draft(database, clone, key)
    draft(database, replaced, key)
    draft(database, first, { ...key, sessionId: randomUUID() })
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM drafts').get().n, 4)
    assert.throws(() => draft(database, first, key), /UNIQUE/)
    assert.throws(() => draft(database, { ...first, workspaceId: randomUUID() }), /FOREIGN KEY/)
    assert.throws(() => database.prepare('DELETE FROM workspace_links WHERE local_folder_id = ?').run(first.folderId), /FOREIGN KEY/)
    assert.throws(() => draft(database, first, { targetId: randomUUID() }), /CHECK/)
  } finally { database.close() }
})

test('JSON 객체·정수 payload 버전·안전한 revision·단일 앱 설정·UTF-8 크기를 강제한다', (t) => {
  const { directory } = fixture(t)
  const database = databaseAt(directory)
  try {
    const insert = database.prepare('INSERT INTO app_preferences VALUES (?, ?, ?, ?, ?)')
    for (const body of ['{', '[]', 'null', '{}', '{"payloadVersion":null}', '{"payloadVersion":"1"}', '{"payloadVersion":1.0}', '{"payloadVersion":2}']) {
      assert.throws(() => insert.run(1, 0, 1, body, time), /CHECK/, body)
    }
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) { assert.throws(() => insert.run(1, revision, 1, json, time)) }
    assert.throws(() => insert.run(2, 0, 1, json, time), /CHECK/)
    assert.throws(() => insert.run(1, 0, 1, json, 'not a timestamp'), /CHECK/)
    const scope = seedScope(database)
    assert.throws(() => draft(database, scope, { body: '{"payloadVersion":1,"text":"한글"}', byteSize: 1 }), /CHECK/)
    const prefix = '{"payloadVersion":1,"text":"'
    const suffix = '"}'
    const exact = prefix + 'a'.repeat(256 * 1024 - Buffer.byteLength(prefix + suffix)) + suffix
    insert.run(1, Number.MAX_SAFE_INTEGER, 1, exact, time)
    assert.throws(() => database.prepare('UPDATE app_preferences SET json = ?').run(exact.replace('aaa', 'aaaa')), /CHECK/)
    assert.throws(() => database.prepare('UPDATE app_preferences SET revision = revision + 1').run(), /CHECK/)
  } finally { database.close() }
})

test('저장 이력은 폴더·공간·operation/API 조합으로 중복을 막고 트랜잭션 롤백을 보존한다', (t) => {
  const { directory } = fixture(t)
  const database = databaseAt(directory)
  try {
    const scope = seedScope(database)
    const apiId = randomUUID()
    const operationId = randomUUID()
    const insert = database.prepare('INSERT INTO api_save_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const values = [scope.folderId, scope.workspaceId, apiId, operationId, time, randomUUID(), '기본 세트', 'GET', '/robots', 1, json, jsonBytes]
    insert.run(randomUUID(), ...values)
    database.exec('BEGIN IMMEDIATE')
    try {
      draft(database, scope)
      assert.throws(() => insert.run(randomUUID(), ...values), /UNIQUE/)
    } finally { database.exec('ROLLBACK') }
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM drafts').get().n, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM api_save_history').get().n, 1)
  } finally { database.close() }
})

for (const scenario of ['empty', 'unknown', 'wrong-id', 'future-db', 'zero-version', 'checksum', 'missing-index', 'future-payload', 'missing-migration', 'altered-schema', 'invalid-json', 'broken-fk', 'corrupt']) {
  test(`기존 ${scenario} DB를 거부하고 원본 파일을 변경하지 않는다`, (t) => {
    const { directory, file } = fixture(t)
    if (scenario === 'empty') { writeFileSync(file, '') }
    else if (scenario === 'corrupt') { writeFileSync(file, 'not a database: preserve me') }
    else if (scenario === 'unknown') {
      const database = new DatabaseSync(file)
      database.exec('CREATE TABLE important (value TEXT); INSERT INTO important VALUES (\'preserve me\')')
      database.close()
    } else {
      const database = databaseAt(directory)
      if (scenario === 'wrong-id') { database.exec('PRAGMA application_id = 42') }
      if (scenario === 'future-db') { database.exec('PRAGMA user_version = 2') }
      if (scenario === 'zero-version') { database.exec('PRAGMA user_version = 0') }
      if (scenario === 'checksum') { database.prepare('UPDATE schema_migrations SET migration_checksum = ?').run('0'.repeat(64)) }
      if (scenario === 'missing-index') { database.exec('DROP INDEX drafts_by_api_updated') }
      if (scenario === 'future-payload') {
        database.exec('PRAGMA ignore_check_constraints = ON')
        database.prepare('INSERT INTO app_preferences VALUES (?, ?, ?, ?, ?)').run(1, 0, 2, '{"payloadVersion":2}', time)
      }
      if (scenario === 'missing-migration') { database.exec('DELETE FROM schema_migrations') }
      if (scenario === 'altered-schema') { database.exec('ALTER TABLE local_folders ADD COLUMN unexpected TEXT') }
      if (scenario === 'invalid-json') {
        database.exec('PRAGMA ignore_check_constraints = ON')
        database.prepare('INSERT INTO app_preferences VALUES (?, ?, ?, ?, ?)').run(1, 0, 1, '{', time)
      }
      if (scenario === 'broken-fk') {
        database.exec('PRAGMA foreign_keys = OFF')
        database.prepare('INSERT INTO workspace_links VALUES (?, ?, ?, ?)').run(randomUUID(), randomUUID(), 'orphan', time)
      }
      database.close()
    }
    const before = readFileSync(file)
    const code = scenario === 'future-db' || scenario === 'future-payload' ? 'DATABASE_VERSION_UNSUPPORTED' : 'DATABASE_UNAVAILABLE'
    assert.throws(() => databaseAt(directory), error => {
      assert.equal(error.code, code)
      assert.equal(error.message.includes(directory), false)
      assert.equal(error.message.includes('SELECT'), false)
      return true
    })
    assert.deepEqual(readFileSync(file), before)
  })
}

test('Worker 서비스는 실제 DB를 생성하고 종료 전 접수된 작업을 완료하며 종료는 멱등적이다', async (t) => {
  const { directory, file } = fixture(t)
  const database = await openPersonalDatabase({ userData: directory, appVersion: '0.1.0' })
  t.after(() => database.close())
  const statuses = Array.from({ length: 10 }, () => database.status())
  const closing = database.close()
  assert.equal(database.close(), closing)
  await assert.rejects(database.status(), { code: 'DATABASE_UNAVAILABLE' })
  for (const status of await Promise.all(statuses)) {
    assert.equal(status.schemaVersion, 1)
    assert.equal(status.journalMode, 'wal')
    assert.equal(status.foreignKeys, true)
    assert.equal(status.synchronous, 2)
    assert.equal(status.busyTimeoutMs, 1000)
  }
  await closing
  assert.ok(readFileSync(file).length > 0)
  const reopened = await openPersonalDatabase({ userData: directory, appVersion: '0.1.0' })
  assert.equal((await reopened.status()).schemaVersion, 1)
  await reopened.close()
})

test('Worker 시작 실패는 경로·SQL을 노출하지 않고 호출자에게 반환한다', async (t) => {
  const { directory, file } = fixture(t)
  writeFileSync(file, 'private content')
  await assert.rejects(openPersonalDatabase({ userData: directory, appVersion: '0.1.0' }), error => {
    assert.equal(error.code, 'DATABASE_UNAVAILABLE')
    assert.equal(error.message.includes(directory), false)
    assert.equal(error.message.includes('private'), false)
    return true
  })
  assert.equal(readFileSync(file, 'utf8'), 'private content')
})

test('Worker는 SQL·임의 키 작업 메시지를 거부하고 연결을 닫는다', async (t) => {
  const { directory } = fixture(t)
  const worker = new Worker(path.resolve('dist-electron/electron/personal-database-worker.cjs'), { workerData: { userData: directory, appVersion: '0.1.0' } })
  const exit = once(worker, 'exit')
  const [ready] = await once(worker, 'message')
  assert.equal(ready.kind, 'ready')
  worker.postMessage({ id: 1, operation: 'execute', sql: 'DROP TABLE drafts' })
  const [reply] = await once(worker, 'message')
  assert.equal(reply.kind, 'failed')
  await exit
  const database = databaseAt(directory)
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM drafts').get().n, 0)
  database.close()
})


test('예기치 않은 Worker 종료 뒤 상태 확인·종료는 성공으로 대체되지 않는다', async (t) => {
  const { directory } = fixture(t)
  const workerThreads = require('node:worker_threads')
  const OriginalWorker = workerThreads.Worker
  let worker
  // 실제 Worker를 유지하면서 테스트에서만 강제 종료할 참조를 얻습니다.
  t.mock.method(workerThreads, 'Worker', function (filename, options) {
    worker = new OriginalWorker(filename, options)
    return worker
  })
  const database = await openPersonalDatabase({ userData: directory, appVersion: '0.1.0' })
  await worker.terminate()
  await assert.rejects(database.status(), { code: 'DATABASE_UNAVAILABLE' })
  await assert.rejects(database.close(), { code: 'DATABASE_UNAVAILABLE' })
})
