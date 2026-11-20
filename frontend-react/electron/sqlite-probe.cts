// 호환성 검사 전용 모듈. 일반 앱의 Main·Preload·Renderer에서는 불러오지 않습니다.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

export type SqliteProbeOptions = { directory: string; token: string; stage: 'write' | 'verify' }
export type SqliteProbeResult = {
  stage: 'write' | 'verify'
  electron: string
  node: string
  sqlite: string
  threadId: number
  rows: number
  rollbackVerified: boolean
  integrityVerified: boolean
  readOnlyVerified: boolean
}

/** 검증 실행기가 만든 임시 디렉터리와 실행별 식별자를 확인한 후 Worker를 실행합니다. */
export async function runSqliteProbe(options: SqliteProbeOptions): Promise<SqliteProbeResult> {
  assert.ok(path.isAbsolute(options.directory))
  assert.ok(options.stage === 'write' || options.stage === 'verify')
  const marker = JSON.parse(await readFile(path.join(options.directory, 'probe.json'), 'utf8')) as { purpose: string; token: string }
  assert.equal(marker.purpose, 'apidoc-sqlite-compatibility')
  assert.equal(marker.token, options.token)
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'sqlite-probe-worker.cjs'), { workerData: options })
    let result: SqliteProbeResult | undefined
    let failure: Error | undefined
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('SQLite Worker 검증 시간 초과')) }, 15000)
    worker.on('message', (message: { ok: boolean; result?: SqliteProbeResult; message?: string }) => {
      if (message.ok) { result = message.result } else { failure = new Error(message.message ?? 'SQLite Worker 검증 실패') }
    })
    worker.once('error', (error) => { clearTimeout(timeout); reject(error) })
    worker.once('exit', (code) => {
      clearTimeout(timeout)
      if (failure || code !== 0 || !result) { reject(failure ?? new Error(`SQLite Worker 종료 코드 ${code}`)); return }
      resolve(result)
    })
  })
}
