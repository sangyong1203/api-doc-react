import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { PersonalDataClient, PersonalOperation } from './personal-data-contract.cjs'
import { PersonalDatabaseError } from './personal-database-contract.cjs'
import type { PersonalDatabaseErrorCode, PersonalDatabaseStatus, PersonalBackup, PersonalBackupReference, PersonalRecoveryResult } from './personal-database-contract.cjs'

export type PersonalDatabase = {
  personal: PersonalDataClient
  backup: (directory?: string) => Promise<PersonalBackup>
  /** 사용자 확인·현재 편집 처리를 끝낸 Main 전용. 호출 즉시 신규 접수를 차단하고 완료 후 Worker를 종료합니다. */
  restore: (backup: PersonalBackupReference) => Promise<PersonalRecoveryResult>
  status: () => Promise<PersonalDatabaseStatus>
  /** 신규 접수를 차단하고 먼저 받은 작업·연결 종료·Worker 종료까지 기다립니다. 중복 호출은 같은 Promise를 반환합니다. */
  close: () => Promise<void>
}

const activeProfiles = new Set<string>()

// 같은 Main에서 열린 서비스가 있는 동안 별도 복구 Worker가 파일을 교체하지 못하게 합니다.
function claimProfile(userData: string): () => void {
  if (!path.isAbsolute(userData)) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
  const key = path.resolve(userData)
  if (activeProfiles.has(key)) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
  activeProfiles.add(key)
  return () => { activeProfiles.delete(key) }
}

type WorkerReply =
  | { kind: 'ready'; status: PersonalDatabaseStatus }
  | { kind: 'failed'; error: { code: PersonalDatabaseErrorCode } }
  | { kind: 'result'; id: number; ok: true; data: unknown }
  | { kind: 'result'; id: number; ok: false; error: { code: PersonalDatabaseErrorCode } }

/**
 * Main이 소유할 개인 DB 서비스. userData는 app.getPath('userData')의 절대 경로이며 Renderer 입력을 받지 않습니다.
 * 현재는 기반 모듈만 제공하며 실제 앱 시작·종료/IPC 연결은 후속 작업에서 수행합니다.
 */
export function openPersonalDatabase(options: { userData: string; appVersion: string }): Promise<PersonalDatabase> {
  return new Promise((resolve, reject) => {
    let release: (() => void) | undefined
    let worker: Worker
    try {
      release = claimProfile(options.userData)
      worker = new Worker(path.join(__dirname, 'personal-database-worker.cjs'), { workerData: { ...options, migrationBackup: { id: randomUUID(), createdAt: new Date().toISOString() } } })
    } catch {
      release?.()
      reject(new PersonalDatabaseError('DATABASE_UNAVAILABLE'))
      return
    }
    let ready = false
    let stopping = false
    let failure: PersonalDatabaseError | undefined
    let nextId = 0
    let closePromise: Promise<void> | undefined
    const pending = new Map<number, {
      resolve: (value: unknown) => void
      reject: (error: PersonalDatabaseError) => void
    }>()
    let resolveExit: () => void
    let rejectExit: (error: PersonalDatabaseError) => void
    const exited = new Promise<void>((done, fail) => { resolveExit = done; rejectExit = fail })
    // 시작 실패나 예기치 않은 종료가 close() 호출 전 발생해도 미처리 rejection을 만들지 않습니다.
    void exited.catch(() => {})
    const fail = (error: PersonalDatabaseError) => {
      failure ??= error
      stopping = true
      reject(failure)
      for (const item of pending.values()) { item.reject(failure) }
      pending.clear()
    }
    const request = <T,>(operation: 'status' | 'close' | 'backup' | 'restore' | PersonalOperation, input?: unknown): Promise<T> => {
      if (failure || (stopping && operation !== 'close' && operation !== 'restore') || nextId >= Number.MAX_SAFE_INTEGER) {
        return Promise.reject(failure ?? new PersonalDatabaseError('DATABASE_UNAVAILABLE'))
      }
      return new Promise((done, failRequest) => {
        const id = ++nextId
        pending.set(id, { resolve: value => done(value as T), reject: failRequest })
        try { worker.postMessage(input === undefined ? { id, operation } : { id, operation, input }) } catch {
          fail(new PersonalDatabaseError('DATABASE_UNAVAILABLE'))
          void worker.terminate()
        }
      })
    }
    worker.on('message', (reply: WorkerReply) => {
      if (reply.kind === 'failed') {
        fail(new PersonalDatabaseError(reply.error.code))
      } else if (reply.kind === 'ready') {
        ready = true
        const personal: PersonalDataClient = {
          rememberWorkspace: input => request('rememberWorkspace', input),
          workspacePath: input => request('workspacePath', input),
          preferences: input => request('preferences', input),
          savePreferences: input => request('savePreferences', input),
          drafts: input => request('drafts', input),
          draft: input => request('draft', input),
          saveDraft: input => request('saveDraft', input),
          removeDraft: input => request('removeDraft', input),
          recordHistory: input => request('recordHistory', input),
          history: input => request('history', input),
          historyEntry: input => request('historyEntry', input),
        }
        resolve({
          personal,
          backup: directory => request('backup', { ...(directory === undefined ? {} : { directory }), id: randomUUID(), createdAt: new Date().toISOString() }),
          restore(backup) {
            if (stopping) { return Promise.reject(new PersonalDatabaseError('DATABASE_UNAVAILABLE')) }
            stopping = true
            closePromise = exited
            return Promise.all([request<PersonalRecoveryResult>('restore', { databasePath: backup.databasePath, metadataPath: backup.metadataPath }), exited]).then(([result]) => result)
          },
          async status() {
            const status = await request<PersonalDatabaseStatus>('status')
            if (!status) { throw new PersonalDatabaseError('DATABASE_UNAVAILABLE') }
            return status
          },
          close() {
            if (!closePromise) {
              stopping = true
              closePromise = Promise.all([request('close'), exited]).then(() => {})
            }
            return closePromise
          },
        })
      } else {
        const item = pending.get(reply.id)
        if (!item) { return }
        pending.delete(reply.id)
        if (reply.ok) { item.resolve(reply.data) } else { item.reject(new PersonalDatabaseError(reply.error.code)) }
      }
    })
    worker.once('error', () => fail(new PersonalDatabaseError('DATABASE_UNAVAILABLE')))
    worker.once('exit', (code) => {
      release?.()
      if (code !== 0 || !ready || !stopping || pending.size > 0 || failure) {
        const error = failure ?? new PersonalDatabaseError('DATABASE_UNAVAILABLE')
        fail(error)
        rejectExit(error)
      } else { resolveExit() }
    })
  })
}


/**
 * 손상 DB 또는 미완료 복구용 Main 내부 API. 사용자 확인·파일 복구 저널 확인 후 모든 연결을 닫아야 합니다.
 * restore는 네이티브 선택 백업, rollback은 현재 marker의 operationId만 받으며 SQL·이동 경로를 받지 않습니다.
 */
export function recoverPersonalDatabase(options: { userData: string } & (
  { action: 'restore'; backup: PersonalBackupReference } | { action: 'rollback'; operationId: string }
)): Promise<PersonalRecoveryResult> {
  return new Promise((resolve, reject) => {
    let release: (() => void) | undefined
    let worker: Worker
    try {
      release = claimProfile(options.userData)
      const workerData = options.action === 'restore'
        ? { userData: options.userData, action: 'restore', backup: { databasePath: options.backup.databasePath, metadataPath: options.backup.metadataPath } }
        : { userData: options.userData, action: 'rollback', operationId: options.operationId }
      worker = new Worker(path.join(__dirname, 'personal-database-recovery-worker.cjs'), { workerData })
    } catch {
      release?.()
      reject(new PersonalDatabaseError('DATABASE_UNAVAILABLE'))
      return
    }
    let result: PersonalRecoveryResult | undefined
    let failure: PersonalDatabaseError | undefined
    worker.on('message', (reply: { ok: boolean; data?: PersonalRecoveryResult; code?: PersonalDatabaseErrorCode }) => {
      if (reply.ok && reply.data) { result = reply.data }
      else { failure = new PersonalDatabaseError(reply.code ?? 'DATABASE_UNAVAILABLE') }
    })
    worker.once('error', () => { failure = new PersonalDatabaseError('DATABASE_UNAVAILABLE') })
    worker.once('exit', code => {
      release?.()
      if (failure || code !== 0 || !result) { reject(failure ?? new PersonalDatabaseError('DATABASE_UNAVAILABLE')) }
      else { resolve(result) }
    })
  })
}
