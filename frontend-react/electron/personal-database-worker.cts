import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { DatabaseSync } from 'node:sqlite'
import { PersonalDatabaseError } from './personal-database-contract.cjs'
import { openPersonalDatabaseConnection, personalDatabaseStatus } from './personal-database-schema.cjs'

if (isMainThread || !parentPort) { throw new Error('개인 DB는 전용 Worker에서만 실행합니다.') }
const port = parentPort
let database: DatabaseSync | undefined
let accepting = true
let queue = Promise.resolve()

function failure(error: unknown) {
  const safe = error instanceof PersonalDatabaseError ? error : new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  return { code: safe.code, message: safe.message }
}

try {
  const options = workerData as { userData?: unknown; appVersion?: unknown } | null
  if (!options || typeof options.userData !== 'string' || typeof options.appVersion !== 'string') {
    throw new PersonalDatabaseError('DATABASE_UNAVAILABLE')
  }
  database = openPersonalDatabaseConnection(options.userData, options.appVersion)
  port.postMessage({ kind: 'ready', status: personalDatabaseStatus(database) })
} catch (error) {
  port.postMessage({ kind: 'failed', error: failure(error) })
  accepting = false
  port.close()
}

// Promise 큐를 사용해 향후 비동기 백업도 완료될 때까지 다음 DB 작업을 시작하지 않습니다.
port.on('message', (message: unknown) => {
  if (!accepting) { return }
  const request = message as { id?: unknown; operation?: unknown } | null
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).length !== 2 || !Number.isSafeInteger(request.id) || Number(request.id) < 1
    || (request.operation !== 'status' && request.operation !== 'close')) {
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
  if (operation === 'close') { accepting = false }
  queue = queue.then(() => {
    try {
      if (!database) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
      if (operation === 'close') {
        database.close()
        database = undefined
        port.postMessage({ kind: 'result', id, ok: true, data: null })
        port.close()
      } else {
        port.postMessage({ kind: 'result', id, ok: true, data: personalDatabaseStatus(database) })
      }
    } catch (error) {
      port.postMessage({ kind: 'result', id, ok: false, error: failure(error) })
      accepting = false
      try { database?.close() } catch { /* Worker 종료 시 SQLite가 남은 연결을 회수합니다. */ }
      port.close()
    }
  })
})
