import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { PersonalDatabaseError } from './personal-database-contract.cjs'
import { restoreClosedPersonalDatabase, rollbackPersonalRecovery } from './personal-database-recovery.cjs'
import { object, text } from './personal-data-validation.cjs'

if (isMainThread || !parentPort) { throw new Error('복구는 전용 Worker에서만 실행합니다.') }
const port = parentPort
void (async () => {
  try {
    const input = object(workerData, ['userData', 'action', 'backup', 'operationId'], ['userData', 'action'])
    text(input.userData)
    let result
    if (input.action === 'restore') {
      object(input, ['userData', 'action', 'backup'])
      const reference = object(input.backup, ['databasePath', 'metadataPath'])
      text(reference.databasePath); text(reference.metadataPath)
      result = await restoreClosedPersonalDatabase(input.userData, { databasePath: reference.databasePath, metadataPath: reference.metadataPath })
    } else {
      object(input, ['userData', 'action', 'operationId'])
      if (input.action !== 'rollback') { throw new PersonalDatabaseError('INVALID_REQUEST') }
      text(input.operationId)
      result = await rollbackPersonalRecovery(input.userData, input.operationId)
    }
    port.postMessage({ ok: true, data: result })
  } catch (error) {
    const safe = error instanceof PersonalDatabaseError ? error : new PersonalDatabaseError('DATABASE_UNAVAILABLE')
    port.postMessage({ ok: false, code: safe.code })
  } finally { port.close() }
})()
