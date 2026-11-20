import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isMainThread, parentPort, threadId, workerData } from 'node:worker_threads'
import type { SqliteProbeOptions, SqliteProbeResult } from './sqlite-probe.cjs'

assert.equal(isMainThread, false)
const options = workerData as SqliteProbeOptions
const databasePath = path.join(options.directory, 'compatibility.sqlite')
const sample = { text: "한글·따옴표 ' SQL 문자", count: 0, enabled: false, empty: '', optional: null, nested: [1, '둘'] }

function sqliteCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'errcode' in error
    && typeof error.errcode === 'number' && (error.errcode & 0xff) === code
}

function probe(): SqliteProbeResult {
  // 새 파일 생성과 재실행 후 읽기를 구분해 다른 DB를 덮어쓰지 않습니다.
  assert.equal(existsSync(databasePath), options.stage === 'verify')
  const database = new DatabaseSync(databasePath, { readOnly: options.stage === 'verify', timeout: 1000 })
  try {
    if (options.stage === 'write') {
      assert.equal(database.prepare('PRAGMA journal_mode = WAL').get()?.journal_mode, 'wal')
      database.exec('PRAGMA synchronous = FULL; CREATE TABLE probe_values (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;')
      const insert = database.prepare('INSERT INTO probe_values (id, value) VALUES (?, ?)')
      insert.run(1, JSON.stringify({ token: options.token, sample }))
      database.exec('BEGIN IMMEDIATE')
      insert.run(2, 'committed')
      database.exec('COMMIT')
      // 일부 쓰기 후 제약 오류가 나더라도 같은 트랜잭션의 변경이 남지 않아야 합니다.
      database.exec('BEGIN IMMEDIATE')
      try {
        insert.run(3, 'must roll back')
        assert.throws(() => insert.run(2, 'duplicate primary key'), (error) => sqliteCode(error, 19))
      } finally { database.exec('ROLLBACK') }
      assert.equal(database.prepare('SELECT id FROM probe_values WHERE id = 3').get(), undefined)
    }
    const rows = database.prepare('SELECT id, value FROM probe_values ORDER BY id').all()
    assert.equal(rows.length, 2)
    assert.deepEqual(JSON.parse(rows[0].value as string), { token: options.token, sample })
    assert.equal(rows[1].value, 'committed')
    assert.equal(database.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok')
    if (options.stage === 'verify') {
      assert.equal(database.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal')
      assert.throws(() => database.exec("INSERT INTO probe_values VALUES (4, 'read only')"), (error) => sqliteCode(error, 8))
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM probe_values').get()?.count, 2)
    }
    return {
      stage: options.stage, electron: process.versions.electron, node: process.versions.node,
      sqlite: database.prepare('SELECT sqlite_version() AS version').get()?.version as string,
      threadId, rows: rows.length, rollbackVerified: true, integrityVerified: true, readOnlyVerified: options.stage === 'verify',
    }
  } finally { database.close() }
}

try { parentPort?.postMessage({ ok: true, result: probe() }) } catch (error) {
  parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : 'SQLite 검증 실패' })
  process.exitCode = 1
}
