import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { PersonalDatabaseError } from './personal-database-contract.cjs'
import type { PersonalDatabaseErrorCode, PersonalDatabaseStatus } from './personal-database-contract.cjs'

export type PersonalDatabase = {
  status: () => Promise<PersonalDatabaseStatus>
  /** 신규 접수를 차단하고 먼저 받은 작업·연결 종료·Worker 종료까지 기다립니다. 중복 호출은 같은 Promise를 반환합니다. */
  close: () => Promise<void>
}

type WorkerReply =
  | { kind: 'ready'; status: PersonalDatabaseStatus }
  | { kind: 'failed'; error: { code: PersonalDatabaseErrorCode } }
  | { kind: 'result'; id: number; ok: true; data: PersonalDatabaseStatus | null }
  | { kind: 'result'; id: number; ok: false; error: { code: PersonalDatabaseErrorCode } }

/**
 * Main이 소유할 개인 DB 서비스. userData는 app.getPath('userData')의 절대 경로이며 Renderer 입력을 받지 않습니다.
 * 현재는 기반 모듈만 제공하며 실제 앱 시작·종료/IPC 연결은 후속 작업에서 수행합니다.
 */
export function openPersonalDatabase(options: { userData: string; appVersion: string }): Promise<PersonalDatabase> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'personal-database-worker.cjs'), { workerData: options })
    let ready = false
    let stopping = false
    let failure: PersonalDatabaseError | undefined
    let nextId = 0
    let closePromise: Promise<void> | undefined
    const pending = new Map<number, {
      resolve: (value: PersonalDatabaseStatus | null) => void
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
    const request = (operation: 'status' | 'close'): Promise<PersonalDatabaseStatus | null> => {
      if (failure || (stopping && operation !== 'close') || nextId >= Number.MAX_SAFE_INTEGER) {
        return Promise.reject(failure ?? new PersonalDatabaseError('DATABASE_UNAVAILABLE'))
      }
      return new Promise((done, failRequest) => {
        const id = ++nextId
        pending.set(id, { resolve: done, reject: failRequest })
        try { worker.postMessage({ id, operation }) } catch {
          fail(new PersonalDatabaseError('DATABASE_UNAVAILABLE'))
        }
      })
    }
    worker.on('message', (reply: WorkerReply) => {
      if (reply.kind === 'failed') {
        fail(new PersonalDatabaseError(reply.error.code))
      } else if (reply.kind === 'ready') {
        ready = true
        resolve({
          async status() {
            const status = await request('status')
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
      if (code !== 0 || !ready || !stopping || pending.size > 0 || failure) {
        const error = failure ?? new PersonalDatabaseError('DATABASE_UNAVAILABLE')
        fail(error)
        rejectExit(error)
      } else { resolveExit() }
    })
  })
}
