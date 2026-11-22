import { createHash } from 'node:crypto'
import { openSync, closeSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { PERSONAL_RECOVERY_MARKER, PersonalDatabaseError } from './personal-database-contract.cjs'
import type { PersonalDatabaseStatus } from './personal-database-contract.cjs'

export const PERSONAL_SCHEMA_VERSION = 1
export const PERSONAL_APPLICATION_ID = 0x41504443
const MAX_REVISION = Number.MAX_SAFE_INTEGER

// 열 이름은 아래 고정 DDL에서만 전달하며 외부 입력으로 SQL 식별자를 만들지 않습니다.
function uuidColumn(column: string): string {
  return `${column} TEXT NOT NULL CHECK (length(${column}) = 36
    AND substr(${column}, 9, 1) = '-' AND substr(${column}, 14, 1) = '-'
    AND substr(${column}, 19, 1) = '-' AND substr(${column}, 24, 1) = '-'
    AND length(replace(${column}, '-', '')) = 32
    AND replace(${column}, '-', '') NOT GLOB '*[^0-9a-f]*')`
}

function timestampColumn(column: string): string {
  return `${column} TEXT NOT NULL CHECK (length(${column}) = 24
    AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) = ${column}, 0))`
}

/** JSON 본문의 전체 DTO 검증은 저장 처리에서 수행하며 DDL은 자료형·버전·UTF-8 크기 경계를 보장합니다. */
function jsonColumns(maxBytes: number): string {
  return `payload_version INTEGER NOT NULL CHECK (payload_version = 1),
    json TEXT NOT NULL CHECK (length(CAST(json AS BLOB)) <= ${maxBytes}
      AND CASE WHEN json_valid(json) THEN coalesce(json_type(json) = 'object'
        AND json_type(json, '$.payloadVersion') = 'integer'
        AND json_extract(json, '$.payloadVersion') = payload_version, 0) ELSE 0 END)`
}

const revisionColumn = `revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND ${MAX_REVISION})`
const scopeColumns = `${uuidColumn('local_folder_id')}, ${uuidColumn('workspace_id')}`
const scopeForeignKey = 'FOREIGN KEY (local_folder_id, workspace_id) REFERENCES workspace_links(local_folder_id, workspace_id) ON DELETE RESTRICT'

/** v1을 배포한 뒤에는 이 DDL을 바꾸지 않고 별도 순차 migration을 추가해야 합니다. */
export const PERSONAL_SCHEMA_SQL = [
  `CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    ${timestampColumn('applied_at')},
    app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 128),
    migration_checksum TEXT NOT NULL CHECK (length(migration_checksum) = 64 AND migration_checksum NOT GLOB '*[^0-9a-f]*')
  ) STRICT`,
  `CREATE TABLE local_folders (
    ${uuidColumn('local_folder_id')} PRIMARY KEY,
    canonical_path TEXT NOT NULL CHECK (length(canonical_path) > 0),
    path_key TEXT NOT NULL UNIQUE CHECK (length(path_key) > 0),
    ${timestampColumn('created_at')}, ${timestampColumn('last_opened_at')},
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
  ) STRICT`,
  `CREATE TABLE workspace_links (
    ${scopeColumns}, display_name TEXT NOT NULL,
    ${timestampColumn('last_opened_at')},
    PRIMARY KEY (local_folder_id, workspace_id),
    FOREIGN KEY (local_folder_id) REFERENCES local_folders(local_folder_id) ON DELETE RESTRICT
  ) STRICT`,
  `CREATE TABLE app_preferences (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    ${revisionColumn}, ${jsonColumns(256 * 1024)}, ${timestampColumn('updated_at')}
  ) STRICT`,
  `CREATE TABLE workspace_preferences (
    ${scopeColumns}, ${revisionColumn}, ${jsonColumns(256 * 1024)}, ${timestampColumn('updated_at')},
    PRIMARY KEY (local_folder_id, workspace_id), ${scopeForeignKey}
  ) STRICT`,
  `CREATE TABLE drafts (
    ${scopeColumns}, ${uuidColumn('api_id')},
    target_kind TEXT NOT NULL CHECK (target_kind IN ('api', 'preset')),
    ${uuidColumn('target_id')}, ${uuidColumn('edit_session_id')}, ${revisionColumn},
    base_revision TEXT NOT NULL CHECK (length(base_revision) = 71 AND substr(base_revision, 1, 7) = 'sha256:'
      AND substr(base_revision, 8) NOT GLOB '*[^0-9a-f]*'),
    ${jsonColumns(8 * 1024 * 1024)},
    byte_size INTEGER NOT NULL CHECK (byte_size = length(CAST(json AS BLOB))),
    ${timestampColumn('updated_at')},
    CHECK (target_kind <> 'api' OR target_id = api_id),
    PRIMARY KEY (local_folder_id, workspace_id, api_id, target_kind, target_id, edit_session_id),
    ${scopeForeignKey}
  ) STRICT`,
  `CREATE TABLE api_save_history (
    ${uuidColumn('id')} PRIMARY KEY, ${scopeColumns}, ${uuidColumn('api_id')}, ${uuidColumn('operation_id')},
    ${timestampColumn('saved_at')}, ${uuidColumn('preset_id')}, preset_name TEXT NOT NULL,
    method TEXT NOT NULL, url TEXT NOT NULL, ${jsonColumns(8 * 1024 * 1024)},
    byte_size INTEGER NOT NULL CHECK (byte_size = length(CAST(json AS BLOB))),
    UNIQUE (local_folder_id, workspace_id, operation_id, api_id), ${scopeForeignKey}
  ) STRICT`,
  'CREATE INDEX drafts_by_api_updated ON drafts (local_folder_id, workspace_id, api_id, updated_at DESC)',
  'CREATE INDEX history_by_api_saved ON api_save_history (local_folder_id, workspace_id, api_id, saved_at DESC, id DESC)',
] as const

export const PERSONAL_MIGRATION_CHECKSUM = createHash('sha256').update(PERSONAL_SCHEMA_SQL.join(';\n')).digest('hex')

export type PersonalSchema = {
  version: number
  statements: readonly string[]
  migrations: readonly { version: number; checksum: string }[]
}
export const PERSONAL_SCHEMA: PersonalSchema = {
  version: PERSONAL_SCHEMA_VERSION,
  statements: PERSONAL_SCHEMA_SQL,
  migrations: [{ version: 1, checksum: PERSONAL_MIGRATION_CHECKSUM }],
}

function scalar(database: DatabaseSync, sql: string): unknown {
  const row = database.prepare(sql).get()
  return row ? Object.values(row)[0] : undefined
}

/** 상태 확인은 SQL이나 개인 데이터를 반환하지 않습니다. */
export function personalDatabaseStatus(database: DatabaseSync): PersonalDatabaseStatus {
  return {
    schemaVersion: Number(scalar(database, 'PRAGMA user_version')),
    sqliteVersion: String(scalar(database, 'SELECT sqlite_version()')),
    journalMode: String(scalar(database, 'PRAGMA journal_mode')),
    foreignKeys: scalar(database, 'PRAGMA foreign_keys') === 1,
    synchronous: Number(scalar(database, 'PRAGMA synchronous')),
    busyTimeoutMs: Number(scalar(database, 'PRAGMA busy_timeout')),
  }
}

function normalizedSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** 기존 파일은 버전 숫자뿐 아니라 migration·DDL·외래 키·JSON 버전까지 검사합니다. */
export function verifyPersonalSchema(database: DatabaseSync, schema: PersonalSchema = PERSONAL_SCHEMA): void {
  if (scalar(database, 'PRAGMA application_id') !== PERSONAL_APPLICATION_ID) {
    throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  }
  const version = Number(scalar(database, 'PRAGMA user_version'))
  if (version > schema.version) { throw new PersonalDatabaseError('DATABASE_VERSION_UNSUPPORTED') }
  if (version !== schema.version) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }

  const objects = database.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
  const expected = schema.statements.map(normalizedSql).sort()
  const actual = objects.map((row) => typeof row.sql === 'string' ? normalizedSql(row.sql) : '').sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
  const migrations = database.prepare('SELECT version, applied_at, app_version, migration_checksum FROM schema_migrations ORDER BY version').all()
  if (migrations.length !== schema.migrations.length || migrations.some((row, index) => row.version !== schema.migrations[index].version || row.migration_checksum !== schema.migrations[index].checksum)) {
    throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
  for (const table of ['app_preferences', 'workspace_preferences', 'drafts', 'api_save_history']) {
    if (database.prepare(`SELECT 1 FROM ${table} WHERE payload_version > 1
      OR CASE WHEN json_valid(json) THEN json_extract(json, '$.payloadVersion') > 1 ELSE 0 END LIMIT 1`).get()) {
      throw new PersonalDatabaseError('DATABASE_VERSION_UNSUPPORTED')
    }
  }
  if (scalar(database, 'PRAGMA integrity_check') !== 'ok') { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
}

/**
 * Worker 내부 전용. userData는 Main이 선택한 절대 경로, appVersion은 비어 있지 않은 앱 버전(최대 128자)입니다.
 * 기존 DB는 읽기 전용으로 검사하며 알 수 없는 DB나 생성 중 남은 빈 파일을 다시 초기화하지 않습니다.
 */
export function openPersonalDatabaseConnection(userData: string, appVersion: string, schema: PersonalSchema = PERSONAL_SCHEMA): DatabaseSync {
  if (!path.isAbsolute(userData) || !appVersion.trim() || appVersion.length > 128) {
    throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  }
  let database: DatabaseSync | undefined
  let writing = false
  try {
    if (existsSync(path.join(userData, PERSONAL_RECOVERY_MARKER))) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
    mkdirSync(userData, { recursive: true })
    const databasePath = path.join(userData, 'personal.sqlite')
    let created = false
    try {
      // wx는 이미 있는 파일을 덮어쓰지 않으며, 검사 실패 시 파일을 삭제하거나 재생성하지 않습니다.
      closeSync(openSync(databasePath, 'wx', 0o600))
      created = true
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) { throw error }
    }
    const options = { allowExtension: false, enableForeignKeyConstraints: true, timeout: 1000 }
    if (!created) {
      const inspection = new DatabaseSync(databasePath, { ...options, readOnly: true })
      try { verifyPersonalSchema(inspection, schema) } finally { inspection.close() }
      if (!existsSync(databasePath)) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
    }
    database = new DatabaseSync(databasePath, options)
    if (created) {
      if (schema.version !== 1) { throw new PersonalDatabaseError('DATABASE_VERSION_UNSUPPORTED') }
      writing = true
      database.exec('BEGIN IMMEDIATE')
      try {
        for (const sql of PERSONAL_SCHEMA_SQL) { database.exec(sql) }
        database.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)')
          .run(1, new Date().toISOString(), appVersion, PERSONAL_MIGRATION_CHECKSUM)
        database.exec(`PRAGMA application_id = ${PERSONAL_APPLICATION_ID}; PRAGMA user_version = ${PERSONAL_SCHEMA_VERSION}`)
        verifyPersonalSchema(database, schema)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    } else {
      // 읽기 전용 검사 이후 정상 연결에서도 같은 식별·버전·DDL인지 재검사합니다.
      verifyPersonalSchema(database, schema)
    }
    writing = true
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 1000')
    const status = personalDatabaseStatus(database)
    if (!status.foreignKeys || status.journalMode !== 'wal' || status.synchronous !== 2 || status.busyTimeoutMs !== 1000) {
      throw new PersonalDatabaseError('DATABASE_WRITE_FAILED')
    }
    return database
  } catch (error) {
    try { database?.close() } catch { /* 원본 오류를 유지하며 DB를 자동 초기화하지 않습니다. */ }
    if (error instanceof PersonalDatabaseError) { throw error }
    throw new PersonalDatabaseError(writing ? 'DATABASE_WRITE_FAILED' : 'DATABASE_UNAVAILABLE')
  }
}
