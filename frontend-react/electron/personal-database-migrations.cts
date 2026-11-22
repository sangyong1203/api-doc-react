import { existsSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PERSONAL_RECOVERY_MARKER, PersonalDatabaseError } from './personal-database-contract.cjs'
import type { BackupIdentity } from './personal-database-backup.cjs'
import { createPersonalBackup, finishMigrationBackup, verifyPersonalContents } from './personal-database-backup.cjs'
import { openPersonalDatabaseConnection, PERSONAL_SCHEMA } from './personal-database-schema.cjs'
import type { PersonalSchema } from './personal-database-schema.cjs'

export type PersonalMigration = {
  schema: PersonalSchema
  /** 소스에 작성한 트랜잭션 가능 DDL·데이터 변환만 허용합니다. Main/IPC 입력으로 받지 않습니다. */
  apply: (database: DatabaseSync) => void
}
export const PERSONAL_MIGRATIONS: readonly PersonalMigration[] = [{ schema: PERSONAL_SCHEMA, apply: () => {} }]

/** 현재는 v1만 등록돼 있습니다. 테스트용 상위 스키마도 같은 엔진을 거치며 배포 DB 버전을 올리지 않습니다. */
export async function openMigratedPersonalDatabase(userData: string, appVersion: string, migrations: readonly PersonalMigration[] = PERSONAL_MIGRATIONS, backupIdentity?: BackupIdentity): Promise<DatabaseSync> {
  let database: DatabaseSync | undefined
  let transaction = false
  try {
    if (!path.isAbsolute(userData) || !appVersion.trim() || appVersion.length > 128 || migrations.length === 0
      || migrations.some((step, index) => step.schema.version !== index + 1)) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
    if (existsSync(path.join(userData, PERSONAL_RECOVERY_MARKER))) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
    const file = path.join(userData, 'personal.sqlite')
    if (!existsSync(file)) { openPersonalDatabaseConnection(userData, appVersion).close() }
    const inspection = new DatabaseSync(file, { readOnly: true, allowExtension: false, timeout: 1000 })
    let source: PersonalMigration
    try {
      const version = Number(inspection.prepare('PRAGMA user_version').get()?.user_version)
      if (version > migrations.length) { throw new PersonalDatabaseError('DATABASE_VERSION_UNSUPPORTED') }
      const known = migrations.find(step => step.schema.version === version)
      if (!known) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
      verifyPersonalContents(inspection, known.schema)
      source = known
    } finally { inspection.close() }
    database = openPersonalDatabaseConnection(userData, appVersion, source.schema)
    if (source.schema.version === migrations.length) { return database }

    // 백업 실패 시 migration을 시작하지 않습니다. 이후 실패한 백업은 pending으로 보존합니다.
    const directory = path.join(userData, 'backups')
    const snapshot = await createPersonalBackup(database, directory, appVersion, 'migration', source.schema, backupIdentity)
    database.exec('BEGIN IMMEDIATE')
    transaction = true
    for (const step of migrations.slice(source.schema.version)) {
      step.apply(database)
      if (!database.isTransaction) { throw new PersonalDatabaseError('DATABASE_WRITE_FAILED') }
      const migration = step.schema.migrations.find(item => item.version === step.schema.version)
      if (!migration) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
      database.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)')
        .run(step.schema.version, new Date().toISOString(), appVersion, migration.checksum)
      database.exec(`PRAGMA user_version = ${step.schema.version}`)
      verifyPersonalContents(database, step.schema)
    }
    database.exec('COMMIT')
    transaction = false
    verifyPersonalContents(database, migrations.at(-1)!.schema)
    await finishMigrationBackup(snapshot, directory, source.schema)
    return database
  } catch (error) {
    if (transaction) { try { database?.exec('ROLLBACK') } catch { /* SQLite 연결 종료 복구에 맡기고 API는 열지 않습니다. */ } }
    try { database?.close() } catch { /* DB·백업을 유지하며 자동 교체하지 않습니다. */ }
    if (error instanceof PersonalDatabaseError) { throw error }
    throw new PersonalDatabaseError(database ? 'DATABASE_WRITE_FAILED' : 'DATABASE_UNAVAILABLE')
  }
}
