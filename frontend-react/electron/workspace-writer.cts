import type { ContentHash, DesktopErrorCode, DocumentKind, WorkspaceCommit } from '../src/types/desktopData.js'
import { object, text, uuid } from './personal-data-validation.cjs'
import { readWorkspaceFiles, readWorkspaceSnapshot } from './workspace-files.cjs'
import { validateWorkspaceBundle, WORKSPACE_LIMITS, WorkspaceError } from './workspace-format.cjs'
import { cleanupWriteTemporary, contentHash, replaceWorkspaceFile, serializeWorkspaceDocument, stableJson } from './workspace-write-files.cjs'
import { decodeImage, imageHash, isHash, relativeDocument, temporaryDocument, WorkspaceWriteJournal } from './workspace-write-journal.cjs'
import type { FileCommitResult, FileOperationStatus, JournalChange, WriteJournal, WriteScope } from './workspace-write-journal.cjs'

export type FileCommit = Omit<WorkspaceCommit, 'handle'>
type Pending = Extract<WriteJournal, { status: 'pending' }>
const queues = new Map<string, Promise<unknown>>()
const active = new Set<string>()
function revision(hashes: Record<string, ContentHash>): ContentHash {
  return contentHash(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))
}
function safeError(error: unknown): WorkspaceError {
  return error instanceof WorkspaceError ? error : new WorkspaceError('FILE_WRITE_FAILED')
}
function validateRequest(input: unknown): FileCommit {
  try {
    const data = object(input, ['operationId', 'expectedRevision', 'changes', 'selectedPresetId'], ['operationId', 'expectedRevision', 'changes'])
    uuid(data.operationId)
    if (data.selectedPresetId !== undefined) { uuid(data.selectedPresetId) }
    if (!isHash(data.expectedRevision) || !Array.isArray(data.changes) || !data.changes.length || data.changes.length > WORKSPACE_LIMITS.files) { throw new WorkspaceError('INVALID_REQUEST') }
    const paths = new Set<string>()
    let bytes = 0
    const changes = data.changes.map(value => {
      const change = object(value, ['action', 'kind', 'id', 'expectedHash', 'json'], ['action', 'kind', 'id', 'expectedHash'])
      uuid(change.id)
      if (!['workspace', 'api', 'environment'].includes(String(change.kind))) { throw new WorkspaceError('INVALID_REQUEST') }
      const kind = change.kind as DocumentKind
      const relative = relativeDocument(kind, change.id)
      if (paths.has(relative)) { throw new WorkspaceError('INVALID_REQUEST') }
      paths.add(relative)
      if (change.action === 'delete') {
        object(change, ['action', 'kind', 'id', 'expectedHash'])
        if (kind === 'workspace' || !isHash(change.expectedHash)) { throw new WorkspaceError('INVALID_REQUEST') }
        return { action: 'delete' as const, kind: kind as 'api' | 'environment', id: change.id, expectedHash: change.expectedHash }
      }
      if (change.action !== 'put' || change.expectedHash !== null && !isHash(change.expectedHash)) { throw new WorkspaceError('INVALID_REQUEST') }
      text(change.json)
      bytes += Buffer.byteLength(change.json)
      if (Buffer.byteLength(change.json) > WORKSPACE_LIMITS.fileBytes || bytes > WORKSPACE_LIMITS.totalBytes) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
      let json: string
      try { json = serializeWorkspaceDocument(kind, JSON.parse(change.json)) } catch { throw new WorkspaceError('DOCUMENT_INVALID') }
      if (Buffer.byteLength(json) > WORKSPACE_LIMITS.fileBytes) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
      return { action: 'put' as const, kind, id: change.id, expectedHash: change.expectedHash, json }
    }).sort((a, b) => { const left = relativeDocument(a.kind, a.id), right = relativeDocument(b.kind, b.id); return left < right ? -1 : left > right ? 1 : 0 })
    return { operationId: data.operationId, expectedRevision: data.expectedRevision, changes, ...(data.selectedPresetId === undefined ? {} : { selectedPresetId: data.selectedPresetId as string }) }
  } catch (error) {
    if (error instanceof WorkspaceError) { throw error }
    throw new WorkspaceError('INVALID_REQUEST')
  }
}
function metadata(record: WriteJournal) {
  return { version: record.version, localFolderId: record.localFolderId, workspaceId: record.workspaceId, root: record.root, operationId: record.operationId, fingerprint: record.fingerprint, updatedAt: Date.now() }
}
function operationStatus(record: WriteJournal | null): FileOperationStatus {
  if (!record) { return { status: 'unknown' } }
  if (record.status === 'committed') { return { status: 'committed', result: record.result } }
  if (record.status === 'failed') { return { status: 'failed', error: { code: record.code, message: new WorkspaceError(record.code).message } } }
  return { status: 'pending' }
}

/**
 * Main 전용 파일 저장 계층. scope는 검증된 연결에서 공급하며 Renderer 요청으로 만들지 않습니다.
 * 이 클래스는 공유 포맷만 검사합니다. 비밀 실제값 분리와 선택 세트 문맥을 갖춘 상위 계층만 호출해야 합니다.
 * 개인 이력은 별도 트랜잭션이므로 여기서는 파일 결과만 반환합니다. 현재 Preload/UI에 노출하지 않습니다.
 */
export class WorkspaceWriter {
  private constructor(private readonly journal: WorkspaceWriteJournal) {}
  static async open(userData: string): Promise<WorkspaceWriter> {
    try { return new WorkspaceWriter(await WorkspaceWriteJournal.open(userData)) } catch (error) { throw safeError(error) }
  }
  /** 같은 실제 폴더의 모든 인스턴스·handle 쓰기를 직렬화하며 실패가 다음 작업 큐를 끊지 않습니다. */
  private async serial<T>(scope: WriteScope, action: () => Promise<T>): Promise<T> {
    const key = scope.root.canonicalPath
    const previous = queues.get(key) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(action)
    queues.set(key, result)
    try { return await result } catch (error) { throw safeError(error) } finally { if (queues.get(key) === result) { queues.delete(key) } }
  }
  private scope(input: WriteScope): WriteScope {
    try { uuid(input.localFolderId); uuid(input.workspaceId) } catch { throw new WorkspaceError('INVALID_REQUEST') }
    return { localFolderId: input.localFolderId, workspaceId: input.workspaceId, root: { ...input.root } }
  }
  /** 응답을 잃은 작업은 재전송하지 않고 상태를 조회합니다. unknown은 성공/실패 판정이 아닙니다. */
  async status(input: WriteScope, operationId: string): Promise<FileOperationStatus> {
    const scope = this.scope(input)
    try { uuid(operationId) } catch { throw new WorkspaceError('INVALID_REQUEST') }
    try {
      await this.journal.guard(scope)
      if (active.has(`${scope.root.canonicalPath}:${operationId}`)) { return { status: 'pending' } }
      return operationStatus(await this.journal.read(scope, operationId))
    } catch (error) { throw error instanceof WorkspaceError ? error : new WorkspaceError('FILE_READ_FAILED') }
  }
  /** 다시 열 때 미완료 작업을 조회하고 새 쓰기를 막기 위한 내부 API입니다. */
  async pending(input: WriteScope): Promise<string[]> {
    const scope = this.scope(input)
    return this.serial(scope, async () => (await this.journal.list(scope)).filter(record => record.status === 'pending').map(record => record.operationId))
  }
  async commit(inputScope: WriteScope, input: unknown): Promise<FileCommitResult> {
    const scope = this.scope(inputScope), request = validateRequest(input)
    const fingerprint = contentHash(stableJson({ localFolderId: scope.localFolderId, workspaceId: scope.workspaceId, ...request }))
    return this.serial(scope, async () => {
      await this.journal.guard(scope)
      const prior = await this.journal.read(scope, request.operationId)
      if (prior) {
        if (prior.fingerprint !== fingerprint) { throw new WorkspaceError('OPERATION_ID_REUSED') }
        if (prior.status === 'committed') { return prior.result }
        if (prior.status === 'failed') { throw new WorkspaceError(prior.code) }
        throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED')
      }
      if ((await this.journal.list(scope)).some(record => record.status === 'pending')) { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
      await this.journal.prune(scope, 1)
      const operationKey = `${scope.root.canonicalPath}:${request.operationId}`
      active.add(operationKey)
      let record: Pending | undefined
      let prepared = false, appliedAll = false
      try {
        const snapshot = await readWorkspaceSnapshot(scope.root)
        if (snapshot.workspace.id !== scope.workspaceId) { throw new WorkspaceError('WORKSPACE_NOT_OPEN') }
        if (snapshot.revision !== request.expectedRevision) { throw new WorkspaceError('FILE_CONFLICT') }
        const before = Object.fromEntries([snapshot.workspace, ...snapshot.apis, ...snapshot.environments].map(doc => [relativeDocument(doc.kind, doc.id), doc.json]))
        const base = Object.fromEntries([snapshot.workspace, ...snapshot.apis, ...snapshot.environments].map(doc => [relativeDocument(doc.kind, doc.id), doc.hash]))
        const after = { ...before }
        const changes: JournalChange[] = request.changes.map(change => {
          const relative = relativeDocument(change.kind, change.id)
          if (change.kind === 'workspace' && change.id !== scope.workspaceId) { throw new WorkspaceError('INVALID_REQUEST') }
          if ((base[relative] ?? null) !== change.expectedHash) { throw new WorkspaceError('FILE_CONFLICT') }
          const json = change.action === 'put' ? change.json : null
          if (json === null) { delete after[relative] } else { after[relative] = json }
          return { kind: change.kind, id: change.id, before: before[relative] === undefined ? null : Buffer.from(before[relative]).toString('base64'), after: json === null ? null : Buffer.from(json).toString('base64') }
        })
        if (validateWorkspaceBundle(after).id !== scope.workspaceId) { throw new WorkspaceError('INVALID_REQUEST') }
        const hashes = Object.fromEntries(Object.entries(after).map(([relative, json]) => [relative, contentHash(json)]))
        record = { version: 1, ...scope, operationId: request.operationId, fingerprint, updatedAt: Date.now(), status: 'pending', base, targetRevision: revision(hashes), changes }
        await this.journal.write(scope, record)
        prepared = true
        // 저널 기록 동안 외부 도구가 바꾼 경우도 포함해, 첫 교체 직전에 전체 기준을 다시 확인합니다.
        await this.apply(scope, record, 'complete', request.expectedRevision)
        appliedAll = true
        return await this.finish(scope, record)
      } catch (error) {
        if (record && !prepared && await this.journal.read(scope, record.operationId)) { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
        if (record && prepared) {
          if (appliedAll) { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
          // 실패 후 원본으로 되돌릴 수 있는 경우에만 보상합니다. 제3의 내용은 건드리지 않습니다.
          try { await this.restore(scope, record, safeError(error).code) } catch { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
        }
        throw safeError(error)
      } finally { active.delete(operationKey) }
    })
  }
  /** mode는 사용자가 선택한 복구 방향입니다. 자동 재시도나 외부 편집 강제 덮어쓰기를 하지 않습니다. */
  async recover(input: WriteScope, operationId: string, mode: 'complete' | 'rollback'): Promise<FileOperationStatus> {
    const scope = this.scope(input)
    try { uuid(operationId) } catch { throw new WorkspaceError('INVALID_REQUEST') }
    if (mode !== 'complete' && mode !== 'rollback') { throw new WorkspaceError('INVALID_REQUEST') }
    return this.serial(scope, async () => {
      const record = await this.journal.read(scope, operationId)
      if (!record || record.status !== 'pending') { return operationStatus(record) }
      try {
        if (mode === 'rollback') { await this.restore(scope, record, 'FILE_WRITE_FAILED') }
        else { await this.apply(scope, record, mode); await this.finish(scope, record) }
        return operationStatus(await this.journal.read(scope, operationId))
      } catch { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
    })
  }
  /** 각 파일이 원본/후보 중 하나이며 다른 파일과 목록이 기준과 일치하는지 검사합니다. */
  private async analyze(scope: WriteScope, record: Pending) {
    for (const change of record.changes) {
      await cleanupWriteTemporary(scope.root, temporaryDocument(record.operationId, change), relativeDocument(change.kind, change.id), [decodeImage(change.before), decodeImage(change.after)])
    }
    const current = await readWorkspaceFiles(scope.root)
    const changes = new Map(record.changes.map(change => [relativeDocument(change.kind, change.id), change]))
    const paths = new Set([...Object.keys(record.base), ...Object.keys(current.hashes), ...changes.keys()])
    for (const relative of paths) {
      const actual = current.hashes[relative] ?? null, change = changes.get(relative)
      if (change ? actual !== imageHash(change.before) && actual !== imageHash(change.after) : actual !== (record.base[relative] ?? null)) { throw new WorkspaceError('FILE_CONFLICT') }
    }
    // 저널의 이미지는 크기·해시뿐 아니라 원본/완성본 각각의 공유 문서 관계도 검증합니다.
    const original = { ...current.files }, desired = { ...current.files }
    for (const change of record.changes) {
      const relative = relativeDocument(change.kind, change.id)
      const oldJson = decodeImage(change.before), newJson = decodeImage(change.after)
      if (oldJson === null) { delete original[relative] } else { original[relative] = oldJson }
      if (newJson === null) { delete desired[relative] } else { desired[relative] = newJson }
    }
    if (validateWorkspaceBundle(original).id !== scope.workspaceId || validateWorkspaceBundle(desired).id !== scope.workspaceId) { throw new WorkspaceError('DOCUMENT_INVALID') }
    return current
  }
  private async apply(scope: WriteScope, record: Pending, mode: 'complete' | 'rollback', initialRevision?: ContentHash): Promise<void> {
    const current = await this.analyze(scope, record)
    if (initialRevision && current.revision !== initialRevision) { throw new WorkspaceError('FILE_CONFLICT') }
    for (const change of record.changes) {
      // 대상 파일은 replaceWorkspaceFile에서 교체 직전 재검사하고 전체 목록은 완료 전에 다시 검사합니다.
      const relative = relativeDocument(change.kind, change.id)
      const image = mode === 'complete' ? change.after : change.before
      if ((current.hashes[relative] ?? null) !== imageHash(image)) {
        await replaceWorkspaceFile(scope.root, relative, current.hashes[relative] ?? null, decodeImage(image), temporaryDocument(record.operationId, change))
      }
    }
    const final = await this.analyze(scope, record)
    const expected = mode === 'complete' ? record.targetRevision : revision(record.base)
    if (final.revision !== expected) { throw new WorkspaceError('FILE_CONFLICT') }
  }
  private async finish(scope: WriteScope, record: Pending): Promise<FileCommitResult> {
    const result: FileCommitResult = { operationId: record.operationId, revision: record.targetRevision, documents: record.changes.map(change => ({ kind: change.kind, id: change.id, hash: imageHash(change.after) })) }
    await this.journal.write(scope, { ...metadata(record), status: 'committed', result })
    return result
  }
  private async restore(scope: WriteScope, record: Pending, code: DesktopErrorCode): Promise<void> {
    await this.apply(scope, record, 'rollback')
    const allowed = ['FILE_WRITE_FAILED', 'FILE_CONFLICT', 'DOCUMENT_INVALID', 'PATH_NOT_ALLOWED']
    await this.journal.write(scope, { ...metadata(record), status: 'failed', code: allowed.includes(code) ? code : 'FILE_WRITE_FAILED' })
  }
}
