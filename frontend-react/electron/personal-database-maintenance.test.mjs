import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import sqlite from 'node:sqlite'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const require = createRequire(import.meta.url)
const compiled = path.resolve('dist-electron/electron')
const schemaModule = require(path.join(compiled, 'personal-database-schema.cjs'))
const { openPersonalDatabaseConnection, PERSONAL_SCHEMA } = schemaModule
const backupModule = require(path.join(compiled, 'personal-database-backup.cjs'))
const { createPersonalBackup, verifyPersonalBackup, finishMigrationBackup } = backupModule
const { openMigratedPersonalDatabase } = require(path.join(compiled, 'personal-database-migrations.cjs'))
const { restoreClosedPersonalDatabase, rollbackPersonalRecovery } = require(path.join(compiled, 'personal-database-recovery.cjs'))
const { openPersonalDatabase, recoverPersonalDatabase } = require(path.join(compiled, 'personal-database.cjs'))
const errorCode = code => error => { assert.equal(error.code, code); return true }

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'apidoc-maintenance-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return { directory, file: path.join(directory, 'personal.sqlite'), backups: path.join(directory, 'backups') }
}
function source(directory) {
  const database = openPersonalDatabaseConnection(directory, '0.1.0')
  database.prepare('INSERT INTO app_preferences VALUES (1, 0, 1, ?, ?)').run('{"payloadVersion":1,"theme":"dark"}', new Date().toISOString())
  return database
}
function theme(database) { return JSON.parse(database.prepare('SELECT json FROM app_preferences').get().json).theme }
function metadata(reference) { return JSON.parse(readFileSync(reference.metadataPath, 'utf8')) }
function backupReferences(directory) {
  return readdirSync(directory).map(name => ({ databasePath: path.join(directory, name, 'personal.sqlite'), metadataPath: path.join(directory, name, 'metadata.json') }))
}
function migrationPlan() {
  const steps = [{ schema: PERSONAL_SCHEMA, apply: () => {} }]
  for (let version = 2; version <= 3; version++) {
    const sql = `CREATE INDEX maintenance_test_${version} ON local_folders (last_opened_at)`
    const checksum = createHash('sha256').update(sql).digest('hex')
    const previous = steps.at(-1).schema
    steps.push({ schema: { version, statements: [...previous.statements, sql], migrations: [...previous.migrations, { version, checksum }] }, apply: db => db.exec(sql) })
  }
  return steps
}

test('WAL 백업은 최근 커밋을 포함하며 독립 사본·해시·메타데이터를 검증하고 원본 모드를 유지한다', async t => {
  const { directory, backups, file } = fixture(t)
  const database = source(directory)
  try {
    assert.ok(existsSync(`${file}-wal`))
    const first = await createPersonalBackup(database, backups, '0.1.0', 'manual')
    const second = await createPersonalBackup(database, backups, '0.1.0', 'manual')
    assert.notEqual(first.databasePath, second.databasePath)
    assert.equal(metadata(first).purpose, 'manual')
    assert.equal(metadata(first).migrationStatus, null)
    assert.equal((await verifyPersonalBackup(first)).id, first.id)
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    assert.equal(existsSync(`${first.databasePath}-wal`), false)
    const copy = new DatabaseSync(first.databasePath, { readOnly: true })
    try { assert.equal(theme(copy), 'dark'); assert.equal(copy.prepare('PRAGMA journal_mode').get().journal_mode, 'delete') } finally { copy.close() }
  } finally { database.close() }
})

test('변조·잘못된 메타데이터·상위 버전 백업을 거부한다', async t => {
  const { directory, backups } = fixture(t)
  const database = source(directory)
  try {
    const reference = await createPersonalBackup(database, backups, '0.1.0', 'manual')
    const original = readFileSync(reference.databasePath)
    writeFileSync(reference.databasePath, 'tampered private data')
    await assert.rejects(verifyPersonalBackup(reference), error => { assert.equal(error.code, 'DATABASE_UNAVAILABLE'); assert.equal(error.message.includes('private'), false); return true })
    writeFileSync(reference.databasePath, original)
    const data = metadata(reference)
    writeFileSync(reference.metadataPath, JSON.stringify({ ...data, extraPath: '/unexpected' }))
    await assert.rejects(verifyPersonalBackup(reference), errorCode('DATABASE_UNAVAILABLE'))
    writeFileSync(reference.metadataPath, JSON.stringify({ ...data, schemaVersion: 2 }))
    await assert.rejects(verifyPersonalBackup(reference), errorCode('DATABASE_VERSION_UNSUPPORTED'))
  } finally { database.close() }
})

test('순차 migration은 백업 뒤 같은 트랜잭션에서 DDL·버전·기록을 갱신하고 데이터와 v1 배포 버전을 유지한다', async t => {
  const { directory, backups } = fixture(t)
  source(directory).close()
  const plan = migrationPlan()
  const database = await openMigratedPersonalDatabase(directory, 'test-next-app', plan)
  try {
    assert.equal(theme(database), 'dark')
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 3)
    assert.equal(database.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 3)
    schemaModule.verifyPersonalSchema(database, plan.at(-1).schema)
    assert.equal(metadata(backupReferences(backups)[0]).migrationStatus, 'verified')
    assert.equal(PERSONAL_SCHEMA.version, 1)
  } finally { database.close() }
})

test('뒤 단계 migration 실패는 앞 단계와 버전·기록을 함께 롤백하고 pending 백업을 남긴다', async t => {
  const { directory, backups } = fixture(t)
  source(directory).close()
  const plan = migrationPlan()
  plan[2].apply = db => db.exec('INSERT INTO missing_table VALUES (1)')
  await assert.rejects(openMigratedPersonalDatabase(directory, 'test-next-app', plan), errorCode('DATABASE_WRITE_FAILED'))
  const original = openPersonalDatabaseConnection(directory, '0.1.0')
  try {
    assert.equal(theme(original), 'dark')
    assert.equal(original.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 1)
    assert.equal(original.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'maintenance_test_2'").get(), undefined)
  } finally { original.close() }
  assert.equal(metadata(backupReferences(backups)[0]).migrationStatus, 'pending')
})

test('백업 공간 부족은 migration을 시작하지 않고 원본과 실패한 임시 백업을 보존한다', async t => {
  const { directory, backups } = fixture(t)
  source(directory).close()
  t.mock.method(sqlite, 'backup', async () => { throw Object.assign(new Error('private path ENOSPC'), { code: 'ENOSPC' }) })
  const plan = migrationPlan()
  let applied = false
  plan[1].apply = () => { applied = true }
  await assert.rejects(openMigratedPersonalDatabase(directory, 'test-next-app', plan), errorCode('DATABASE_WRITE_FAILED'))
  assert.equal(applied, false)
  assert.equal(readdirSync(backups).length, 1)
  const original = openPersonalDatabaseConnection(directory, '0.1.0')
  try { assert.equal(theme(original), 'dark') } finally { original.close() }
})

test('자동 백업은 검증 완료된 최근 3개만 남기고 수동·pending 백업은 보존한다', async t => {
  const { directory, backups } = fixture(t)
  const database = source(directory)
  try {
    const manual = await createPersonalBackup(database, backups, '0.1.0', 'manual')
    const pending = await createPersonalBackup(database, backups, '0.1.0', 'migration')
    for (let i = 0; i < 5; i++) {
      const reference = await createPersonalBackup(database, backups, '0.1.0', 'migration')
      await finishMigrationBackup(reference, backups, PERSONAL_SCHEMA)
    }
    const records = backupReferences(backups).map(metadata)
    assert.equal(records.filter(row => row.migrationStatus === 'verified').length, 3)
    assert.ok(existsSync(manual.databasePath)); assert.ok(existsSync(pending.databasePath))
  } finally { database.close() }
})

test('복구는 원본·WAL·SHM을 한곳에 보존한 뒤 후보를 설치하며 표식을 제거한다', async t => {
  const { directory, backups, file } = fixture(t)
  const database = source(directory)
  const reference = await createPersonalBackup(database, backups, '0.1.0', 'manual')
  database.prepare('UPDATE app_preferences SET json = ?').run('{"payloadVersion":1,"theme":"light"}')
  database.close()
  const before = readFileSync(file)
  writeFileSync(`${file}-wal`, 'preserve WAL')
  writeFileSync(`${file}-shm`, 'preserve SHM')
  const result = await restoreClosedPersonalDatabase(directory, reference)
  assert.deepEqual(readFileSync(path.join(result.preservedDirectory, 'original/personal.sqlite')), before)
  assert.equal(readFileSync(path.join(result.preservedDirectory, 'original/personal.sqlite-wal'), 'utf8'), 'preserve WAL')
  assert.equal(readFileSync(path.join(result.preservedDirectory, 'original/personal.sqlite-shm'), 'utf8'), 'preserve SHM')
  assert.equal(existsSync(path.join(directory, 'personal-recovery.json')), false)
  const restored = openPersonalDatabaseConnection(directory, '0.1.0')
  try { assert.equal(theme(restored), 'dark') } finally { restored.close() }
})

test('잘못된 후보 검사는 원본 DB와 백업을 변경하거나 복구 표식을 만들지 않는다', async t => {
  const { directory, file } = fixture(t)
  source(directory).close()
  const before = readFileSync(file)
  await assert.rejects(restoreClosedPersonalDatabase(directory, { databasePath: path.join(directory, 'missing.sqlite'), metadataPath: path.join(directory, 'missing.json') }))
  assert.deepEqual(readFileSync(file), before)
  assert.equal(existsSync(path.join(directory, 'personal-recovery.json')), false)
})

test('모의 Windows 파일 점유 실패 뒤 정상 열기를 차단하고 명시적 원본 복귀로 재개한다', async t => {
  const { directory, backups, file } = fixture(t)
  const database = source(directory)
  const reference = await createPersonalBackup(database, backups, '0.1.0', 'manual')
  database.close()
  const before = readFileSync(file)
  const originalLink = fs.link
  const mocked = t.mock.method(fs, 'link', async (...args) => {
    if (args[1].endsWith(path.join('original', 'personal.sqlite'))) { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }) }
    return originalLink(...args)
  })
  await assert.rejects(restoreClosedPersonalDatabase(directory, reference), errorCode('DATABASE_UNAVAILABLE'))
  assert.throws(() => openPersonalDatabaseConnection(directory, '0.1.0'), errorCode('DATABASE_UNAVAILABLE'))
  mocked.mock.restore()
  const journal = JSON.parse(readFileSync(path.join(directory, 'personal-recovery.json'), 'utf8'))
  await rollbackPersonalRecovery(directory, journal.operationId)
  assert.deepEqual(readFileSync(file), before)
  assert.equal(existsSync(path.join(directory, 'personal-recovery.json')), false)
})

for (const stage of ['original-link', 'candidate-link', 'candidate-installed', 'verified']) {
  test(`복구 ${stage} 단계 강제 종료는 후보·원본을 보존하고 원본 복귀가 가능하다`, async t => {
    const { directory, backups, file } = fixture(t)
    const database = source(directory)
    const reference = await createPersonalBackup(database, backups, '0.1.0', 'manual')
    database.prepare('UPDATE app_preferences SET json = ?').run('{"payloadVersion":1,"theme":"light"}')
    database.close()
    const before = readFileSync(file)
    const code = `
      const fs = require('node:fs/promises'); const path = require('node:path');
      const [directory, databasePath, metadataPath, stage, compiled] = process.argv.slice(1);
      const backup = require(path.join(compiled,'personal-database-backup.cjs'));
      const pause = async () => { console.log('CHECKPOINT'); await new Promise(() => {}); };
      const originalLink = fs.link;
      fs.link = async (source,target) => { await originalLink(source,target);
        if ((stage === 'original-link' && target.endsWith(path.join('original','personal.sqlite'))) ||
          (stage === 'candidate-link' && target === path.join(directory,'personal.sqlite'))) { await pause(); }
      };
      const originalWrite = backup.writeDurableJson;
      backup.writeDurableJson = async (file,data,replace) => { await originalWrite(file,data,replace);
        if (file === path.join(directory,'personal-recovery.json') && data.state === stage) { await pause(); }
      };
      const timer = setInterval(() => {},1000);
      require(path.join(compiled,'personal-database-recovery.cjs')).restoreClosedPersonalDatabase(directory,{databasePath,metadataPath})
        .then(() => { clearInterval(timer); process.exit(2); }, () => { clearInterval(timer); process.exit(3); });
    `
    const child = spawn(process.execPath, ['-e', code, directory, reference.databasePath, reference.metadataPath, stage, compiled], { stdio: ['ignore', 'pipe', 'pipe'] })
    const exit = once(child, 'exit')
    t.after(() => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL') } })
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('checkpoint timeout')) }, 10000)
      child.stdout.on('data', data => { if (data.toString().includes('CHECKPOINT')) { clearTimeout(timeout); resolve() } })
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('checkpoint not reached')) })
    })
    child.kill('SIGKILL'); await exit
    assert.throws(() => openPersonalDatabaseConnection(directory, '0.1.0'), errorCode('DATABASE_UNAVAILABLE'))
    const journal = JSON.parse(readFileSync(path.join(directory, 'personal-recovery.json'), 'utf8'))
    await rollbackPersonalRecovery(directory, journal.operationId)
    assert.deepEqual(readFileSync(file), before)
    assert.ok(existsSync(reference.databasePath))
    assert.equal(existsSync(path.join(directory, 'personal-recovery.json')), false)
  })
}

test('Worker 큐는 백업 뒤 쓰기를 실행하고 복구 중 신규 접수를 막으며 종료 후 다시 열 수 있다', async t => {
  const { directory } = fixture(t)
  let database = await openPersonalDatabase({ userData: directory, appVersion: '0.1.0' })
  try {
    const scope = { kind: 'app' }
    await database.personal.savePreferences({ scope, expectedRevision: null, json: '{"payloadVersion":1,"theme":"dark"}' })
    const backingUp = database.backup()
    const writing = database.personal.savePreferences({ scope, expectedRevision: 0, json: '{"payloadVersion":1,"theme":"light"}' })
    const reference = await backingUp
    await writing
    const copy = new DatabaseSync(reference.databasePath, { readOnly: true })
    try { assert.equal(theme(copy), 'dark') } finally { copy.close() }
    await assert.rejects(recoverPersonalDatabase({ userData: directory, action: 'restore', backup: reference }), errorCode('DATABASE_UNAVAILABLE'))
    const restoring = database.restore(reference)
    await assert.rejects(database.status(), errorCode('DATABASE_UNAVAILABLE'))
    await restoring
    await database.close()
    database = await openPersonalDatabase({ userData: directory, appVersion: '0.1.0' })
    assert.equal(JSON.parse((await database.personal.preferences({ scope })).json).theme, 'dark')
  } finally { await database.close() }
})

test('별도 복구 Worker는 손상 DB를 초기화하지 않고 보존한 채 검증한 백업으로 복구한다', async t => {
  const { directory, backups, file } = fixture(t)
  const database = source(directory)
  const reference = await createPersonalBackup(database, backups, '0.1.0', 'manual')
  database.close()
  writeFileSync(file, 'damaged original, preserve')
  const result = await recoverPersonalDatabase({ userData: directory, action: 'restore', backup: reference })
  assert.equal(readFileSync(path.join(result.preservedDirectory, 'original/personal.sqlite'), 'utf8'), 'damaged original, preserve')
  const restored = await openPersonalDatabase({ userData: directory, appVersion: '0.1.0' })
  try { assert.equal(JSON.parse((await restored.personal.preferences({ scope: { kind: 'app' } })).json).theme, 'dark') } finally { await restored.close() }
})


for (const stage of ['before-commit', 'after-commit']) {
  test(`migration ${stage} 강제 종료 후 DB 버전을 검증하며 백업을 자동 교체하지 않는다`, async t => {
    const { directory, backups } = fixture(t)
    source(directory).close()
    const code = `
      const path = require('node:path'); const {createHash} = require('node:crypto');
      const [directory, stage, compiled] = process.argv.slice(1);
      const base = require(path.join(compiled,'personal-database-schema.cjs')).PERSONAL_SCHEMA;
      const backups = require(path.join(compiled,'personal-database-backup.cjs'));
      const sql = 'CREATE INDEX maintenance_test_2 ON local_folders (last_opened_at)';
      const schema = {version:2,statements:[...base.statements,sql],migrations:[...base.migrations,{version:2,checksum:createHash('sha256').update(sql).digest('hex')}]};
      if (stage === 'after-commit') { backups.finishMigrationBackup = async () => { process.kill(process.pid,'SIGKILL'); }; }
      const steps = [{schema:base,apply:()=>{}},{schema,apply:db=>{db.exec(sql);if(stage === 'before-commit')process.kill(process.pid,'SIGKILL');}}];
      require(path.join(compiled,'personal-database-migrations.cjs')).openMigratedPersonalDatabase(directory,'test-next',steps)
        .then(db=>{db.close();process.exit(2);},()=>process.exit(3));
    `
    const child = spawn(process.execPath, ['-e', code, directory, stage, compiled], { stdio: 'ignore' })
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
    const [status, signal] = await once(child, 'exit')
    clearTimeout(timer)
    assert.equal(status, null); assert.equal(signal, 'SIGKILL')
    const expected = stage === 'before-commit' ? PERSONAL_SCHEMA : migrationPlan()[1].schema
    const database = new DatabaseSync(path.join(directory, 'personal.sqlite'), { readOnly: true })
    try {
      schemaModule.verifyPersonalSchema(database, expected)
      assert.equal(theme(database), 'dark')
      assert.equal(database.prepare('PRAGMA user_version').get().user_version, expected.version)
    } finally { database.close() }
    assert.equal(metadata(backupReferences(backups)[0]).migrationStatus, 'pending')
  })
}
