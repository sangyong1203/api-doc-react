import { randomUUID } from 'node:crypto'
import type { CommitStatus, CommittedWorkspace, DesktopDataApi, DesktopResult, WorkspaceCommit, WorkspaceConnection, WorkspaceSelection } from '../src/types/desktopData.js'
import type { PersonalDatabase } from './personal-database.cjs'
import { object, text, uuid } from './personal-data-validation.cjs'
import { createWorkspaceFiles, readWorkspaceSnapshot, selectWorkspaceRoot } from './workspace-files.cjs'
import type { WorkspaceRoot } from './workspace-files.cjs'
import { validateApiEdit, WorkspaceError } from './workspace-format.cjs'
import { WorkspaceWriter } from './workspace-writer.cjs'
import { isHash } from './workspace-write-journal.cjs'

export type WorkspaceOwner = { windowId: number; frame: object }
type Connection = { owner: WorkspaceOwner; root: WorkspaceRoot; connection: WorkspaceConnection }
export type WorkspaceBridge = Pick<DesktopDataApi['workspace'], 'open' | 'create' | 'snapshot' | 'release' | 'commit' | 'commitStatus'>

/** Main만 네이티브 선택 경로를 공급합니다. Renderer 요청에는 경로를 받지 않습니다. */
export class WorkspaceService {
  private readonly connections = new Map<string, Connection>()
  private readonly selecting = new Set<number>()
  private readonly writes = new Set<Promise<unknown>>()
  private readonly results = new Map<string, CommittedWorkspace>()
  constructor(private readonly database: PersonalDatabase, private readonly selectFolder: (owner: WorkspaceOwner) => Promise<string | null>, private readonly isCurrent: (owner: WorkspaceOwner) => boolean, private readonly writer?: WorkspaceWriter) {}
  releaseOwner(windowId: number): void {
    for (const [handle, item] of this.connections) { if (item.owner.windowId === windowId) { this.connections.delete(handle) } }
  }
  private assertOwner(owner: WorkspaceOwner): void { if (!this.isCurrent(owner)) { throw new WorkspaceError('WORKSPACE_NOT_OPEN') } }
  private connection(owner: WorkspaceOwner, handle: unknown): Connection {
    uuid(handle); this.assertOwner(owner)
    const item = this.connections.get(handle)
    if (!item || item.owner.windowId !== owner.windowId || item.owner.frame !== owner.frame) { throw new WorkspaceError('WORKSPACE_NOT_OPEN') }
    return item
  }
  private async selected(owner: WorkspaceOwner): Promise<string | null> {
    this.assertOwner(owner)
    if (this.selecting.has(owner.windowId)) { throw new WorkspaceError('BUSY') }
    this.selecting.add(owner.windowId)
    try { const result = await this.selectFolder(owner); this.assertOwner(owner); return result } finally { this.selecting.delete(owner.windowId) }
  }
  private async connect(owner: WorkspaceOwner, root: WorkspaceRoot, snapshot: Awaited<ReturnType<typeof readWorkspaceSnapshot>>, expectedWorkspaceId?: string): Promise<WorkspaceSelection> {
    this.assertOwner(owner)
    const workspace = JSON.parse(snapshot.workspace.json) as { id: string; name: string }
    if (expectedWorkspaceId && workspace.id !== expectedWorkspaceId) { throw new WorkspaceError('WORKSPACE_NOT_OPEN') }
    const local = await this.database.personal.rememberWorkspace({ canonicalPath: root.canonicalPath, pathKey: root.canonicalPath, workspaceId: workspace.id, displayName: workspace.name })
    this.assertOwner(owner)
    const existing = [...this.connections.values()].find(item => item.owner.windowId === owner.windowId && item.owner.frame === owner.frame && item.connection.localFolderId === local.localFolderId && item.connection.workspaceId === local.workspaceId)
    const connection = existing?.connection ?? { handle: randomUUID(), ...local, name: workspace.name }
    if (!existing) { this.connections.set(connection.handle, { owner, root, connection }) }
    return { status: 'opened', connection: { ...connection, name: workspace.name }, snapshot }
  }
  async open(owner: WorkspaceOwner, input: unknown): Promise<WorkspaceSelection> {
    const data = object(input, ['source', 'localFolderId'], ['source'])
    let selected: string | null
    let expectedWorkspaceId: string | undefined
    if (data.source === 'dialog') { object(data, ['source']); selected = await this.selected(owner) }
    else {
      if (data.source !== 'recent') { throw new WorkspaceError('INVALID_REQUEST') }
      uuid(data.localFolderId); this.assertOwner(owner)
      const recent = await this.database.personal.workspacePath({ localFolderId: data.localFolderId })
      selected = recent.canonicalPath; expectedWorkspaceId = recent.workspaceId
    }
    if (selected === null) { return { status: 'cancelled' } }
    const root = await selectWorkspaceRoot(selected)
    return this.connect(owner, root, await readWorkspaceSnapshot(root), expectedWorkspaceId)
  }
  async create(owner: WorkspaceOwner, input: unknown): Promise<WorkspaceSelection> {
    const data = object(input, ['name']); text(data.name)
    const name = data.name.trim()
    if (!name || name.length > 200) { throw new WorkspaceError('INVALID_REQUEST') }
    const selected = await this.selected(owner)
    if (selected === null) { return { status: 'cancelled' } }
    const root = await selectWorkspaceRoot(selected)
    this.assertOwner(owner)
    return this.connect(owner, root, await createWorkspaceFiles(root, name))
  }
  async snapshot(owner: WorkspaceOwner, input: unknown) {
    const data = object(input, ['handle'])
    const item = this.connection(owner, data.handle)
    const snapshot = await readWorkspaceSnapshot(item.root)
    this.assertOwner(owner)
    if (snapshot.workspace.id !== item.connection.workspaceId) { throw new WorkspaceError('WORKSPACE_NOT_OPEN') }
    return snapshot
  }
  /** 종료 승인이 난 뒤 새 IPC를 막고, 파일 쓰기와 뒤따르는 개인 이력 처리가 끝날 때까지 기다립니다. */
  async drain(): Promise<void> { await Promise.allSettled([...this.writes]) }
  commit(owner: WorkspaceOwner, input: unknown): Promise<CommittedWorkspace> {
    const task = this.saveApi(owner, input)
    this.writes.add(task)
    void task.finally(() => this.writes.delete(task)).catch(() => {})
    return task
  }
  async commitStatus(owner: WorkspaceOwner, input: unknown): Promise<CommitStatus> {
    const data = object(input, ['handle', 'operationId']); uuid(data.operationId)
    const item = this.connection(owner, data.handle)
    if (!this.writer) { throw new WorkspaceError('INTERNAL_ERROR') }
    const status = await this.writer.status({ root: item.root, ...item.connection }, data.operationId)
    if (status.status !== 'committed') { return status }
    return { status: 'committed', result: this.results.get(`${item.connection.localFolderId}:${data.operationId}`) ?? { ...status.result, history: 'unknown' } }
  }
  private async saveApi(owner: WorkspaceOwner, input: unknown): Promise<CommittedWorkspace> {
    const data = object(input, ['handle', 'operationId', 'expectedRevision', 'selectedPresetId', 'changes'])
    uuid(data.operationId); uuid(data.selectedPresetId)
    const item = this.connection(owner, data.handle)
    if (!this.writer || !isHash(data.expectedRevision) || !Array.isArray(data.changes) || data.changes.length !== 1) { throw new WorkspaceError('INVALID_REQUEST') }
    const change = object(data.changes[0], ['action', 'kind', 'id', 'expectedHash', 'json'])
    uuid(change.id); text(change.json)
    if (change.action !== 'put' || change.kind !== 'api' || !isHash(change.expectedHash) || Buffer.byteLength(change.json) > 8 * 1024 * 1024) { throw new WorkspaceError('INVALID_REQUEST') }
    const request = { operationId: data.operationId, expectedRevision: data.expectedRevision, selectedPresetId: data.selectedPresetId,
      changes: [{ action: 'put', kind: 'api', id: change.id, expectedHash: change.expectedHash, json: change.json }] } satisfies Omit<WorkspaceCommit, 'handle'>
    const scope = { root: item.root, localFolderId: item.connection.localFolderId, workspaceId: item.connection.workspaceId }
    const key = `${scope.localFolderId}:${data.operationId}`
    const prior = await this.writer.status(scope, data.operationId)
    if (prior.status === 'committed') {
      // 상태를 먼저 조회해도 같은 작업 ID의 다른 내용은 파일 계층에서 거부합니다.
      const result = await this.writer.commit(scope, request)
      return this.results.get(key) ?? { ...result, history: 'unknown' }
    }
    if (prior.status === 'pending') { throw new WorkspaceError('WORKSPACE_RECOVERY_REQUIRED') }
    const snapshot = await readWorkspaceSnapshot(item.root)
    this.assertOwner(owner)
    if (snapshot.workspace.id !== scope.workspaceId) { throw new WorkspaceError('WORKSPACE_NOT_OPEN') }
    if (snapshot.revision !== data.expectedRevision || snapshot.apis.find(document => document.id === change.id)?.hash !== change.expectedHash) { throw new WorkspaceError('FILE_CONFLICT') }
    const api = validateApiEdit(snapshot, change.json, change.id, data.selectedPresetId)
    const result = await this.writer.commit(scope, request)
    let history: CommittedWorkspace['history'] = 'recorded'
    try {
      const selected = api.presets.find(preset => preset.id === data.selectedPresetId)!
      await this.database.personal.recordHistory({ scope: { localFolderId: scope.localFolderId, workspaceId: scope.workspaceId }, apiId: api.id, operationId: data.operationId,
        json: JSON.stringify({ payloadVersion: 1, common: { method: api.method, url: api.url, request: api.request, response: api.response, documentation: api.documentation }, selectedPreset: { id: selected.id, name: selected.name, values: selected.values } }) })
    } catch { history = 'failed' }
    const committed = { ...result, history }
    this.results.set(key, committed)
    if (this.results.size > 1000) { this.results.delete(this.results.keys().next().value!) }
    return committed
  }
  release(owner: WorkspaceOwner, input: unknown): null {
    const data = object(input, ['handle'])
    const item = this.connection(owner, data.handle)
    this.connections.delete(item.connection.handle)
    return null
  }
}

/** 잘못된 requestId·예외·경로를 반사하지 않고 Main IPC의 고정 결과로 변환합니다. */
export async function workspaceResult<T>(request: unknown, trusted: boolean, action: (payload: unknown) => Promise<T> | T): Promise<DesktopResult<T>> {
  let requestId: string = randomUUID()
  try {
    if (!trusted) { throw new WorkspaceError('ACCESS_DENIED') }
    const envelope = object(request, ['requestId', 'payload']); uuid(envelope.requestId); requestId = envelope.requestId
    return { requestId, ok: true, data: await action(envelope.payload) }
  } catch (error) {
    const known = error instanceof WorkspaceError ? error : error !== null && typeof error === 'object' && 'code' in error
      && ['INVALID_REQUEST', 'DATABASE_UNAVAILABLE', 'DATABASE_VERSION_UNSUPPORTED', 'NOT_FOUND'].includes(String(error.code))
      ? new WorkspaceError(error.code === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : error.code === 'NOT_FOUND' ? 'WORKSPACE_NOT_FOUND' : 'DATABASE_UNAVAILABLE') : new WorkspaceError('INTERNAL_ERROR')
    return { requestId, ok: false, error: { code: known.code, message: known.message } }
  }
}
