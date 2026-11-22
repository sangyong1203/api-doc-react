import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { DatabaseSync } from 'node:sqlite'
import { PersonalDataStore } from './personal-data-store.cjs'
import { PERSONAL_OPERATIONS } from './personal-data-contract.cjs'
import type { PersonalOperation } from './personal-data-contract.cjs'
import { PersonalDatabaseError } from './personal-database-contract.cjs'
import type { BackupIdentity } from './personal-database-backup.cjs'
import { createPersonalBackup, verifyPersonalBackup } from './personal-database-backup.cjs'
import { openMigratedPersonalDatabase } from './personal-database-migrations.cjs'
import { restoreClosedPersonalDatabase } from './personal-database-recovery.cjs'
import { object, text } from './personal-data-validation.cjs'
import path from 'node:path'
import { personalDatabaseStatus } from './personal-database-schema.cjs'

if (isMainThread || !parentPort) { throw new Error('개인 DB는 전용 Worker에서만 실행합니다.') }
const port = parentPort
let database: DatabaseSync | undefined
let store: PersonalDataStore | undefined
let accepting = true
let userData = ''
let appVersion = ''

function failure(error: unknown) {
  const safe = error instanceof PersonalDatabaseError ? error : new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  return { code: safe.code, message: safe.message }
}

let queue = (async () => {
  try {
    const options = workerData as { userData?: unknown; appVersion?: unknown; migrationBackup?: BackupIdentity } | null
    if (!options || typeof options.userData !== 'string' || typeof options.appVersion !== 'string') {
      throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
    }
    userData = options.userData
    appVersion = options.appVersion
    database = await openMigratedPersonalDatabase(userData, appVersion, undefined, options.migrationBackup)
    store = new PersonalDataStore(database)
    port.postMessage({ kind: 'ready', status: personalDatabaseStatus(database) })
  } catch (error) {
    port.postMessage({ kind: 'failed', error: failure(error) })
    accepting = false
    try { database?.close() } catch { /* 시작 실패 후 연결은 재사용하지 않습니다. */ }
    port.close()
  }
})()

// Promise 큐를 사용해 향후 비동기 백업도 완료될 때까지 다음 DB 작업을 시작하지 않습니다.
port.on('message', (message: unknown) => {
  if (!accepting) { return }
  const request = message as { id?: unknown; operation?: unknown; input?: unknown } | null
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || !Number.isSafeInteger(request.id) || Number(request.id) < 1
    || (request.operation === 'status' || request.operation === 'close'
      ? Object.keys(request).length !== 2
      : typeof request.operation !== 'string' || (!PERSONAL_OPERATIONS.includes(request.operation as PersonalOperation) && request.operation !== 'backup' && request.operation !== 'restore')
        || Object.keys(request).length !== 3 || !Object.hasOwn(request, 'input'))) {
    accepting = false
    queue = queue.then(() => {
      port.postMessage({ kind: 'failed', error: failure(null) })
      database?.close()
      port.close()
    })
    return
  }
  const id = request.id as number
  const operation = request.operation
  if (operation === 'close' || operation === 'restore') { accepting = false }
  queue = queue.then(async () => {
    try {
      if (!database) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
      if (operation === 'close') {
        database.close()
        database = undefined
        port.postMessage({ kind: 'result', id, ok: true, data: null })
        port.close()
      } else if (operation === 'backup') {
        const input = object(request.input, ['directory', 'id', 'createdAt'], ['id', 'createdAt'])
        if (Object.hasOwn(input, 'directory')) { text(input.directory) }
        text(input.id); text(input.createdAt)
        const result = await createPersonalBackup(database, input.directory === undefined ? path.join(userData, 'backups') : input.directory as string, appVersion, 'manual', undefined, { id: input.id, createdAt: input.createdAt })
        port.postMessage({ kind: 'result', id, ok: true, data: result })
      } else if (operation === 'restore') {
        const reference = object(request.input, ['databasePath', 'metadataPath'])
        text(reference.databasePath); text(reference.metadataPath)
        const backup = { databasePath: reference.databasePath, metadataPath: reference.metadataPath }
        await verifyPersonalBackup(backup)
        database.close()
        database = undefined
        store = undefined
        const result = await restoreClosedPersonalDatabase(userData, backup)
        port.postMessage({ kind: 'result', id, ok: true, data: result })
        port.close()
      } else if (operation === 'status') {
        port.postMessage({ kind: 'result', id, ok: true, data: personalDatabaseStatus(database) })
      } else {
        if (!store) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
        port.postMessage({ kind: 'result', id, ok: true, data: store.execute(operation as PersonalOperation, request.input) })
      }
    } catch (error) {
      port.postMessage({ kind: 'result', id, ok: false, error: failure(error) })
      // 검증·충돌·일반 쓰기 실패는 요청 단위로 반환합니다. 읽기 불가/미지원 버전만 연결을 차단합니다.
      if (operation !== 'restore' && error instanceof PersonalDatabaseError && error.code !== 'DATABASE_UNAVAILABLE' && error.code !== 'DATABASE_VERSION_UNSUPPORTED') { return }
      accepting = false
      try { database?.close() } catch { /* Worker 종료 시 SQLite가 남은 연결을 회수합니다. */ }
      port.close()
    }
  })
})
