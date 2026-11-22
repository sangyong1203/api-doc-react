import { randomUUID } from 'node:crypto'
import { copyFile, link, lstat, mkdir, open, readdir, readFile, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PERSONAL_RECOVERY_MARKER, PersonalDatabaseError } from './personal-database-contract.cjs'
import type { PersonalBackupReference, PersonalRecoveryResult } from './personal-database-contract.cjs'
import { hashFile, isPresent, syncDirectory, verifyPersonalBackup, verifyPersonalContents, writeDurableJson } from './personal-database-backup.cjs'
import { object, requireData, uuid } from './personal-data-validation.cjs'

const DATABASE_FILES = ['personal.sqlite', 'personal.sqlite-wal', 'personal.sqlite-shm'] as const

type RecoveryJournal = {
  formatVersion: 1; operationId: string; state: 'prepared' | 'original-preserved' | 'candidate-installed' | 'verified'
  originalFiles: string[]; candidateHash: string
}

/** 연결이 닫힌 파일만 옮깁니다. link의 배타적 생성으로 기존 목적지를 덮어쓰지 않습니다. */
async function moveExclusive(source: string, destination: string): Promise<void> {
  await link(source, destination)
  await unlink(source)
  await syncDirectory(path.dirname(destination))
}
function operationDirectory(userData: string, id: string): string { return path.join(userData, `personal-recovery-${id}`) }

/**
 * 모든 DB 연결·접수를 닫은 뒤 호출하는 Worker 내부 복구 함수입니다.
 * Main은 사용자 선택·미저장 편집 처리·미완료 파일 복구 저널 확인을 먼저 마쳐야 합니다.
 * 완료 후에도 새 handle을 발급하기 전 네이티브 폴더 재선택·manifest 확인이 필요합니다.
 */
export async function restoreClosedPersonalDatabase(userData: string, reference: PersonalBackupReference): Promise<PersonalRecoveryResult> {
  let journalCreated = false
  try {
    requireData(path.isAbsolute(userData))
    const marker = path.join(userData, PERSONAL_RECOVERY_MARKER)
    requireData(!await isPresent(marker))
    const metadata = await verifyPersonalBackup(reference)
    await mkdir(userData, { recursive: true, mode: 0o700 })
    const id = randomUUID()
    const directory = operationDirectory(userData, id)
    const original = path.join(directory, 'original')
    await mkdir(directory, { mode: 0o700 })
    await mkdir(original, { mode: 0o700 })
    const candidate = path.join(directory, 'candidate.sqlite')
    await copyFile(reference.databasePath, candidate, constants.COPYFILE_EXCL)
    const handle = await open(candidate, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    await verifyPersonalBackup({ databasePath: candidate, metadataPath: reference.metadataPath })
    const originalFiles: string[] = []
    for (const name of DATABASE_FILES) { if (await isPresent(path.join(userData, name))) { originalFiles.push(name) } }
    const journal: RecoveryJournal = { formatVersion: 1, operationId: id, state: 'prepared', originalFiles, candidateHash: metadata.sha256 }
    await writeDurableJson(marker, journal)
    journalCreated = true
    // 원본과 sidecar는 같은 디렉터리에 보존합니다. 중간 중단은 marker가 다음 정상 열기를 막습니다.
    for (const name of originalFiles) { await moveExclusive(path.join(userData, name), path.join(original, name)) }
    journal.state = 'original-preserved'
    await writeDurableJson(marker, journal, true)
    await moveExclusive(candidate, path.join(userData, 'personal.sqlite'))
    journal.state = 'candidate-installed'
    await writeDurableJson(marker, journal, true)
    requireData(await hashFile(path.join(userData, 'personal.sqlite')) === metadata.sha256)
    const installed = new DatabaseSync(path.join(userData, 'personal.sqlite'), { readOnly: true, allowExtension: false, timeout: 1000 })
    try { verifyPersonalContents(installed) } finally { installed.close() }
    journal.state = 'verified'
    await writeDurableJson(marker, journal, true)
    await writeDurableJson(path.join(directory, 'result.json'), journal)
    await unlink(marker)
    await syncDirectory(userData)
    return { operationId: id, preservedDirectory: directory }
  } catch (error) {
    if (error instanceof PersonalDatabaseError && error.code === 'DATABASE_VERSION_UNSUPPORTED') { throw error }
    throw new PersonalDatabaseError(journalCreated ? 'DATABASE_UNAVAILABLE' : 'DATABASE_WRITE_FAILED')
  }
}


async function readRecoveryJournal(userData: string): Promise<RecoveryJournal> {
  const marker = path.join(userData, PERSONAL_RECOVERY_MARKER)
  const stat = await lstat(marker)
  requireData(stat.isFile() && stat.size <= 16 * 1024)
  const data = object(JSON.parse(await readFile(marker, 'utf8')) as unknown, ['formatVersion', 'operationId', 'state', 'originalFiles', 'candidateHash'])
  requireData(data.formatVersion === 1
    && ['prepared', 'original-preserved', 'candidate-installed', 'verified'].includes(String(data.state))
    && Array.isArray(data.originalFiles) && data.originalFiles.every(name => DATABASE_FILES.includes(name))
    && new Set(data.originalFiles).size === data.originalFiles.length
    && typeof data.candidateHash === 'string' && /^[0-9a-f]{64}$/.test(data.candidateHash))
  uuid(data.operationId)
  return data as RecoveryJournal
}

/** Main이 복구 안내에 사용할 식별자·단계만 반환합니다. 손상된 표식은 자동 삭제하지 않습니다. */
export async function inspectPersonalRecovery(userData: string): Promise<Pick<RecoveryJournal, 'operationId' | 'state'> | null> {
  try {
    requireData(path.isAbsolute(userData))
    if (!await isPresent(path.join(userData, PERSONAL_RECOVERY_MARKER))) { return null }
    const journal = await readRecoveryJournal(userData)
    return { operationId: journal.operationId, state: journal.state }
  } catch { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
}

/** 실패·중단 후 사용자가 명시적으로 원본 복귀를 선택한 경우에만 호출합니다. 후보를 삭제하지 않습니다. */
export async function rollbackPersonalRecovery(userData: string, operationId: string): Promise<PersonalRecoveryResult> {
  try {
    requireData(path.isAbsolute(userData)); uuid(operationId)
    const marker = path.join(userData, PERSONAL_RECOVERY_MARKER)
    const data = await readRecoveryJournal(userData)
    requireData(data.operationId === operationId)
    const directory = operationDirectory(userData, operationId)
    const original = path.join(directory, 'original')
    requireData((await lstat(directory)).isDirectory() && (await lstat(original)).isDirectory())
    requireData((await readdir(original)).every(name => data.originalFiles.includes(name)))
    const current = path.join(userData, 'personal.sqlite')
    // link 성공 후 unlink 전에 중단될 수 있으므로 inode가 같은 두 경로는 중복 링크만 제거합니다.
    for (const name of DATABASE_FILES) {
      const saved = path.join(original, name)
      const live = path.join(userData, name)
      if (await isPresent(saved) && await isPresent(live)) {
        const a = await lstat(saved), b = await lstat(live)
        if (a.ino !== 0 && a.ino === b.ino && a.dev === b.dev) { await unlink(live) }
        else {
          requireData(name === 'personal.sqlite' && await hashFile(current) === data.candidateHash)
          const retained = path.join(directory, 'candidate-retained.sqlite')
          if (await isPresent(retained)) {
            const c = await lstat(retained)
            requireData(c.ino === b.ino && c.dev === b.dev)
            await unlink(live)
          } else { await moveExclusive(current, retained) }
        }
      }
    }
    if (!data.originalFiles.includes('personal.sqlite') && await isPresent(current)) {
      requireData(await hashFile(current) === data.candidateHash)
      const retained = path.join(directory, 'candidate-retained.sqlite')
      if (await isPresent(retained)) {
        const a = await lstat(current), b = await lstat(retained)
        requireData(a.ino !== 0 && a.ino === b.ino && a.dev === b.dev)
        await unlink(current)
      } else { await moveExclusive(current, retained) }
    }
    for (const name of data.originalFiles) {
      const saved = path.join(original, name)
      const live = path.join(userData, name)
      if (await isPresent(saved)) { await moveExclusive(saved, live) }
      else { requireData(await isPresent(live)) }
    }
    await writeDurableJson(path.join(directory, `rollback-${randomUUID()}.json`), { operationId, restoredOriginal: true })
    await unlink(marker)
    await syncDirectory(userData)
    return { operationId, preservedDirectory: directory }
  } catch {
    throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  }
}
