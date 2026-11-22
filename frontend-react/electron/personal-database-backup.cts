import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, rename, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { PersonalDatabaseError } from './personal-database-contract.cjs'
import type { PersonalBackup, PersonalBackupReference } from './personal-database-contract.cjs'
import { PERSONAL_SCHEMA, verifyPersonalSchema } from './personal-database-schema.cjs'
import type { PersonalSchema } from './personal-database-schema.cjs'
import { object, requireData, text, uuid, validateDraft, validateHistory, validatePreferences } from './personal-data-validation.cjs'

export type BackupIdentity = { id: string; createdAt: string }

export type BackupMetadata = {
  formatVersion: 1; id: string; createdAt: string; appVersion: string; schemaVersion: number; sha256: string
  purpose: 'manual' | 'migration'; migrationStatus: 'pending' | 'verified' | null
}

/** 파일 또는 메타데이터를 닫기 전에 디스크에 동기화합니다. 기존 파일은 wx로 보호합니다. */
export async function writeDurableJson(file: string, data: unknown, replace = false): Promise<void> {
  const target = replace ? `${file}.tmp-${randomUUID()}` : file
  const handle = await open(target, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(data)); await handle.sync() } finally { await handle.close() }
  if (replace) { await rename(target, file) }
  await syncDirectory(path.dirname(file))
}
export async function syncDirectory(directory: string): Promise<void> {
  // Windows의 디렉터리 핸들에는 fsync를 적용할 수 없으며 실제 파일 교체 검증은 Windows에서 별도로 수행합니다.
  if (process.platform === 'win32') { return }
  const handle = await open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) { hash.update(chunk) }
  return hash.digest('hex')
}
export async function isPresent(file: string): Promise<boolean> {
  try { await lstat(file); return true } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return false }
    throw error
  }
}

/** DDL 검증과 개인 DTO 검증을 함께 수행합니다. 백업·복구 검사에서 보관 정리나 데이터 수정을 하지 않습니다. */
export function verifyPersonalContents(database: DatabaseSync, schema: PersonalSchema = PERSONAL_SCHEMA): void {
  verifyPersonalSchema(database, schema)
  try {
    for (const table of ['app_preferences', 'workspace_preferences'] as const) {
      for (const row of database.prepare(`SELECT json FROM ${table}`).iterate()) { validatePreferences(row.json, table === 'app_preferences' ? 'app' : 'workspace') }
    }
    for (const row of database.prepare('SELECT json, target_kind, api_id, target_id FROM drafts').iterate()) {
      requireData(row.target_kind === 'api' || row.target_kind === 'preset')
      validateDraft(row.json, row.target_kind, undefined, [String(row.api_id), String(row.target_id)])
    }
    for (const row of database.prepare('SELECT * FROM api_save_history').iterate()) {
      const entry = validateHistory(row.json, String(row.api_id))
      requireData(entry.method === row.method && entry.url === row.url && entry.presetId === row.preset_id && entry.presetName === row.preset_name)
    }
  } catch (error) {
    if (error instanceof PersonalDatabaseError && error.code === 'DATABASE_VERSION_UNSUPPORTED') { throw error }
    throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  }
}

export async function readBackupMetadata(file: string): Promise<BackupMetadata> {
  const stat = await lstat(file)
  requireData(stat.isFile() && stat.size <= 16 * 1024)
  const data = object(JSON.parse(await readFile(file, 'utf8')) as unknown,
    ['formatVersion', 'id', 'createdAt', 'appVersion', 'schemaVersion', 'sha256', 'purpose', 'migrationStatus'])
  uuid(data.id); text(data.createdAt); text(data.appVersion); text(data.sha256)
  requireData(data.formatVersion === 1 && data.appVersion.trim().length > 0 && data.appVersion.length <= 128
    && Number.isSafeInteger(data.schemaVersion) && Number(data.schemaVersion) >= 1
    && new Date(data.createdAt).toISOString() === data.createdAt && /^[0-9a-f]{64}$/.test(data.sha256)
    && (data.purpose === 'manual' ? data.migrationStatus === null : data.purpose === 'migration' && (data.migrationStatus === 'pending' || data.migrationStatus === 'verified')))
  return data as BackupMetadata
}

/** 경로는 Main이 네이티브 선택으로 얻습니다. 메타데이터 안의 경로는 사용하지 않으며 독립 DB 사본만 허용합니다. */
export async function verifyPersonalBackup(reference: PersonalBackupReference, schema: PersonalSchema = PERSONAL_SCHEMA): Promise<BackupMetadata> {
  try {
    requireData(path.isAbsolute(reference.databasePath) && path.isAbsolute(reference.metadataPath))
    const stat = await lstat(reference.databasePath)
    requireData(stat.isFile() && !await isPresent(`${reference.databasePath}-wal`) && !await isPresent(`${reference.databasePath}-shm`))
    const metadata = await readBackupMetadata(reference.metadataPath)
    if (metadata.schemaVersion > schema.version) { throw new PersonalDatabaseError('DATABASE_VERSION_UNSUPPORTED') }
    requireData(metadata.schemaVersion === schema.version && await hashFile(reference.databasePath) === metadata.sha256)
    const database = new DatabaseSync(reference.databasePath, { readOnly: true, allowExtension: false, timeout: 1000 })
    try {
      requireData(database.prepare('PRAGMA journal_mode').get()?.journal_mode === 'delete')
      verifyPersonalContents(database, schema)
    } finally { database.close() }
    requireData(await hashFile(reference.databasePath) === metadata.sha256)
    return metadata
  } catch (error) {
    if (error instanceof PersonalDatabaseError && error.code === 'DATABASE_VERSION_UNSUPPORTED') { throw error }
    throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  }
}

/** Worker 큐가 다른 작업을 중지한 동안만 호출합니다. 실패한 임시 파일은 진단·복구를 위해 보존합니다. */
export async function createPersonalBackup(database: DatabaseSync, directory: string, appVersion: string, purpose: 'manual' | 'migration', schema: PersonalSchema = PERSONAL_SCHEMA, identity: BackupIdentity = { id: randomUUID(), createdAt: new Date().toISOString() }): Promise<PersonalBackup> {
  verifyPersonalContents(database, schema)
  try {
    requireData(path.isAbsolute(directory) && appVersion.trim().length > 0 && appVersion.length <= 128)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    requireData((await lstat(directory)).isDirectory())
    const { id, createdAt } = identity
    uuid(id); text(createdAt)
    requireData(new Date(createdAt).toISOString() === createdAt)
    const folder = path.join(directory, `${createdAt.replaceAll(':', '-')}-v${schema.version}-${id}`)
    await mkdir(folder, { mode: 0o700 }) // 배타적 새 디렉터리에서만 백업 API를 호출해 기존 파일 덮어쓰기를 방지합니다.
    const temporary = path.join(folder, 'personal.partial.sqlite')
    const reserved = await open(temporary, 'wx', 0o600)
    await reserved.close()
    await backup(database, temporary)
    const copy = new DatabaseSync(temporary, { allowExtension: false, timeout: 1000 })
    try {
      // 백업 사본의 WAL 의존성을 없앤 뒤 봉인합니다. 원본 연결의 journal_mode는 변경하지 않습니다.
      requireData(copy.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode === 'delete')
      verifyPersonalContents(copy, schema)
    } finally { copy.close() }
    const handle = await open(temporary, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    const databasePath = path.join(folder, 'personal.sqlite')
    await rename(temporary, databasePath)
    const metadataPath = path.join(folder, 'metadata.json')
    const metadata: BackupMetadata = {
      formatVersion: 1, id, createdAt, appVersion, schemaVersion: schema.version, sha256: await hashFile(databasePath), purpose,
      migrationStatus: purpose === 'migration' ? 'pending' : null,
    }
    await writeDurableJson(metadataPath, metadata)
    const result = { databasePath, metadataPath, id, schemaVersion: schema.version }
    await verifyPersonalBackup(result, schema)
    return result
  } catch (error) {
    if (error instanceof PersonalDatabaseError && error.code === 'DATABASE_VERSION_UNSUPPORTED') { throw error }
    throw new PersonalDatabaseError('DATABASE_WRITE_FAILED')
  }
}

/** migration 성공·사후 검사 뒤에만 완료 표식을 기록합니다. 수동·실패·알 수 없는 파일은 정리하지 않습니다. */
export async function finishMigrationBackup(reference: PersonalBackupReference, directory: string, schema: PersonalSchema): Promise<void> {
  const metadata = await verifyPersonalBackup(reference, schema)
  requireData(metadata.purpose === 'migration')
  await writeDurableJson(reference.metadataPath, { ...metadata, migrationStatus: 'verified' }, true)
  const backups: Array<{ folder: string; metadata: BackupMetadata }> = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) { continue }
    const folder = path.join(directory, entry.name)
    try {
      const files = (await readdir(folder)).sort()
      if (files.join(',') !== 'metadata.json,personal.sqlite') { continue }
      const data = await readBackupMetadata(path.join(folder, 'metadata.json'))
      if (data.purpose !== 'migration' || data.migrationStatus !== 'verified' || !entry.name.endsWith(`-v${data.schemaVersion}-${data.id}`)) { continue }
      if (await hashFile(path.join(folder, 'personal.sqlite')) !== data.sha256) { continue }
      backups.push({ folder, metadata: data })
    } catch { /* 실패·변조·불완전 백업은 삭제 대상으로 삼지 않습니다. */ }
  }
  // 시계 역행이 있어도 방금 완료한 migration의 사전 백업은 우선 보존합니다.
  backups.sort((a, b) => Number(b.metadata.id === metadata.id) - Number(a.metadata.id === metadata.id)
    || b.metadata.createdAt.localeCompare(a.metadata.createdAt) || b.metadata.id.localeCompare(a.metadata.id))
  for (const item of backups.slice(3)) {
    await unlink(path.join(item.folder, 'metadata.json'))
    await unlink(path.join(item.folder, 'personal.sqlite'))
    await rmdir(item.folder)
  }
  await syncDirectory(directory)
}
