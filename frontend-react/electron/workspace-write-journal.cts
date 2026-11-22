import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ContentHash, DesktopErrorCode, DocumentKind } from '../src/types/desktopData.js'
import { object, uuid } from './personal-data-validation.cjs'
import { directoryCheck, rootCheck } from './workspace-files.cjs'
import type { WorkspaceRoot } from './workspace-files.cjs'
import { WORKSPACE_LIMITS, WorkspaceError } from './workspace-format.cjs'
import { contentHash, syncWriteDirectory } from './workspace-write-files.cjs'

export type FileCommitResult = { operationId: string; revision: ContentHash; documents: Array<{ kind: DocumentKind; id: string; hash: ContentHash | null }> }
export type FileOperationStatus = { status: 'unknown' | 'pending' } | { status: 'committed'; result: FileCommitResult } | { status: 'failed'; error: { code: DesktopErrorCode; message: string } }
export type WriteScope = { root: WorkspaceRoot; localFolderId: string; workspaceId: string }
export type JournalChange = { kind: DocumentKind; id: string; before: string | null; after: string | null }
export type WriteJournal = {
  version: 1; localFolderId: string; workspaceId: string; root: WorkspaceRoot; operationId: string; fingerprint: ContentHash; updatedAt: number
} & ({ status: 'pending'; base: Record<string, ContentHash>; targetRevision: ContentHash; changes: JournalChange[] }
  | { status: 'committed'; result: FileCommitResult } | { status: 'failed'; code: DesktopErrorCode })
export const JOURNAL_LIMITS = Object.freeze({ recordBytes: 192 * 1024 * 1024, totalBytes: 512 * 1024 * 1024, retained: 1000, retentionMs: 30 * 86400_000 })
export const relativeDocument = (kind: DocumentKind, id: string) => kind === 'workspace' ? 'workspace.json' : `${kind === 'api' ? 'apis' : 'environments'}/${id}.json`
export const temporaryDocument = (operationId: string, change: JournalChange) => `.apidoc-write-${operationId}-${change.kind}-${change.id}.tmp`
export function isHash(value: unknown): value is ContentHash { return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value) }
export function decodeImage(image: string | null): string | null { return image === null ? null : new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(image, 'base64')) }
export function imageHash(image: string | null): ContentHash | null { return image === null ? null : contentHash(Buffer.from(image, 'base64')) }
function check(condition: unknown): asserts condition { if (!condition) { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') } }
function validRelative(relative: string): boolean { return relative === 'workspace.json' || /^(apis|environments)\/[0-9a-f-]+\.json$/.test(relative) && (() => { try { uuid(path.posix.basename(relative, '.json')); return true } catch { return false } })() }
function validateImage(value: unknown): asserts value is string | null {
  if (value === null) { return }
  check(typeof value === 'string' && value.length <= Math.ceil(WORKSPACE_LIMITS.fileBytes / 3) * 4)
  const bytes = Buffer.from(value, 'base64')
  check(bytes.length <= WORKSPACE_LIMITS.fileBytes && bytes.toString('base64') === value)
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
}
/** 저널은 경로 권한이 아닙니다. scope와 비교하고 ID로 파일 경로를 다시 조립합니다. */
function validateJournal(value: unknown, scope: WriteScope, operationId: string): WriteJournal {
  const data = object(value, ['version', 'localFolderId', 'workspaceId', 'root', 'operationId', 'fingerprint', 'updatedAt', 'status', 'base', 'targetRevision', 'changes', 'result', 'code'], ['version', 'localFolderId', 'workspaceId', 'root', 'operationId', 'fingerprint', 'updatedAt', 'status'])
  const root = object(data.root, ['canonicalPath', 'device', 'inode'])
  check(data.version === 1 && data.localFolderId === scope.localFolderId && data.workspaceId === scope.workspaceId && data.operationId === operationId && isHash(data.fingerprint))
  check(root.canonicalPath === scope.root.canonicalPath && root.device === scope.root.device && root.inode === scope.root.inode && Number.isSafeInteger(data.updatedAt) && Number(data.updatedAt) >= 0)
  if (data.status === 'pending') {
    object(data, ['version', 'localFolderId', 'workspaceId', 'root', 'operationId', 'fingerprint', 'updatedAt', 'status', 'base', 'targetRevision', 'changes'])
    check(data.base !== null && typeof data.base === 'object' && !Array.isArray(data.base) && isHash(data.targetRevision) && Array.isArray(data.changes) && data.changes.length > 0 && data.changes.length <= WORKSPACE_LIMITS.files)
    const base = data.base as Record<string, unknown>
    check(Object.keys(base).length <= WORKSPACE_LIMITS.files && isHash(base['workspace.json']))
    for (const [relative, hash] of Object.entries(base)) { check(validRelative(relative) && isHash(hash)) }
    const paths = new Set<string>()
    const target = { ...base }
    for (const item of data.changes) {
      const change = object(item, ['kind', 'id', 'before', 'after'])
      check(['workspace', 'api', 'environment'].includes(String(change.kind))); uuid(change.id)
      validateImage(change.before); validateImage(change.after)
      const relative = relativeDocument(change.kind as DocumentKind, change.id)
      check(!paths.has(relative) && (change.kind !== 'workspace' || change.id === scope.workspaceId && change.after !== null))
      paths.add(relative)
      check((base[relative] ?? null) === imageHash(change.before))
      if (change.after === null) { check(change.before !== null); delete target[relative] } else { target[relative] = imageHash(change.after) }
    }
    check(contentHash(JSON.stringify(Object.entries(target).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))) === data.targetRevision)
  } else if (data.status === 'committed') {
    object(data, ['version', 'localFolderId', 'workspaceId', 'root', 'operationId', 'fingerprint', 'updatedAt', 'status', 'result'])
    const result = object(data.result, ['operationId', 'revision', 'documents'])
    check(result.operationId === operationId && isHash(result.revision) && Array.isArray(result.documents) && result.documents.length <= WORKSPACE_LIMITS.files)
    for (const value of result.documents) {
      const document = object(value, ['kind', 'id', 'hash']); uuid(document.id)
      check(['workspace', 'api', 'environment'].includes(String(document.kind)) && (document.hash === null || isHash(document.hash)))
    }
  } else {
    object(data, ['version', 'localFolderId', 'workspaceId', 'root', 'operationId', 'fingerprint', 'updatedAt', 'status', 'code'])
    check(data.status === 'failed' && ['FILE_WRITE_FAILED', 'FILE_CONFLICT', 'DOCUMENT_INVALID', 'PATH_NOT_ALLOWED'].includes(String(data.code)))
  }
  return value as WriteJournal
}

/** 앱의 단일 Main이 소유합니다. 별도 프로세스가 같은 프로필을 동시에 쓰는 용도로 제공하지 않습니다. */
export class WorkspaceWriteJournal {
  private constructor(private readonly directory: WorkspaceRoot) {}
  static async open(userData: string): Promise<WorkspaceWriteJournal> {
    if (!path.isAbsolute(userData)) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    await mkdir(userData, { recursive: true, mode: 0o700 })
    const parent = await realpath(userData)
    const directory = path.join(parent, 'workspace-writes')
    try { await mkdir(directory, { mode: 0o700 }) } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) { throw error }
    }
    const stat = await lstat(directory)
    const root = { canonicalPath: directory, device: stat.dev, inode: stat.ino }
    await directoryCheck(root, directory)
    await syncWriteDirectory(parent)
    return new WorkspaceWriteJournal(root)
  }
  private filename(scope: WriteScope, operationId: string): string {
    uuid(scope.localFolderId); uuid(scope.workspaceId); uuid(operationId)
    return `${scope.localFolderId}-${operationId}.json`
  }
  async guard(scope: WriteScope): Promise<void> {
    await rootCheck(this.directory); await rootCheck(scope.root)
    const journalPath = this.directory.canonicalPath, workspacePath = scope.root.canonicalPath
    const inside = (a: string, b: string) => { const relative = path.relative(a, b); return relative === '' || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative) }
    if (inside(workspacePath, journalPath) || inside(journalPath, workspacePath)) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
  }
  async read(scope: WriteScope, operationId: string): Promise<WriteJournal | null> {
    const name = this.filename(scope, operationId)
    await this.guard(scope)
    const file = path.join(this.directory.canonicalPath, name)
    let found = false
    try {
      const before = await lstat(file)
      found = true
      check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= JOURNAL_LIMITS.recordBytes)
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const opened = await handle.stat()
        check(before.dev === opened.dev && before.ino === opened.ino && before.size === opened.size)
        const bytes = Buffer.alloc(opened.size + 1)
        let size = 0
        while (size < bytes.length) { const read = await handle.read(bytes, size, bytes.length - size, null); if (!read.bytesRead) { break }; size += read.bytesRead }
        const after = await handle.stat(), final = await lstat(file)
        check(size === opened.size && after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs && final.ino === opened.ino && final.dev === opened.dev)
        return validateJournal(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))), scope, operationId)
      } finally { await handle.close() }
    } catch (error) {
      if (!found && error instanceof Error && 'code' in error && error.code === 'ENOENT') { return null }
      throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED')
    }
  }
  async list(scope: WriteScope): Promise<WriteJournal[]> {
    await this.guard(scope)
    const result: WriteJournal[] = []
    const prefix = `${scope.localFolderId}-`
    for (const name of await readdir(this.directory.canonicalPath)) {
      if (!name.startsWith(prefix)) { continue }
      const operationId = name.slice(prefix.length, -5)
      if (!name.endsWith('.json')) { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
      try { uuid(operationId) } catch { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
      const record = await this.read(scope, operationId)
      if (!record) { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
      result.push(record)
    }
    return result
  }
  async write(scope: WriteScope, record: WriteJournal): Promise<void> {
    await this.guard(scope)
    validateJournal(record, scope, record.operationId)
    const bytes = Buffer.from(JSON.stringify(record))
    if (bytes.length > JOURNAL_LIMITS.recordBytes) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
    // 완성한 후보를 원자적으로 교체하기 전에는 기존 복구 기록을 그대로 둡니다.
    let total = 0
    for (const name of await readdir(this.directory.canonicalPath)) { total += (await lstat(path.join(this.directory.canonicalPath, name))).size }
    if (total + bytes.length > JOURNAL_LIMITS.totalBytes) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
    const temporary = path.join(this.directory.canonicalPath, `.journal-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes); await handle.sync(); await handle.close()
      await this.guard(scope)
      await rename(temporary, path.join(this.directory.canonicalPath, this.filename(scope, record.operationId)))
      await syncWriteDirectory(this.directory.canonicalPath)
    } finally {
      await handle.close()
      try { await unlink(temporary) } catch { /* 중단 후 남은 저널 후보는 원본 복구 기록으로 사용하지 않습니다. */ }
    }
  }
  /** 완료 기록만 30일/공간당 최근 1,000건으로 제한합니다. 미래 시각과 미완료 기록은 지우지 않습니다. */
  async prune(scope: WriteScope, reserved = 0): Promise<void> {
    const now = Date.now()
    const records = (await this.list(scope)).filter(record => record.status !== 'pending').sort((a, b) => b.updatedAt - a.updatedAt)
    for (const [index, record] of records.entries()) {
      if (record.updatedAt <= now && (index >= JOURNAL_LIMITS.retained - reserved || now - record.updatedAt > JOURNAL_LIMITS.retentionMs)) {
        await this.guard(scope)
        await unlink(path.join(this.directory.canonicalPath, this.filename(scope, record.operationId)))
      }
    }
    await syncWriteDirectory(this.directory.canonicalPath)
  }
}
