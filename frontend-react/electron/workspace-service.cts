import { randomUUID } from 'node:crypto'
import type { DesktopDataApi, DesktopResult, WorkspaceConnection, WorkspaceSelection } from '../src/types/desktopData.js'
import type { PersonalDatabase } from './personal-database.cjs'
import { object, text, uuid } from './personal-data-validation.cjs'
import { createWorkspaceFiles, readWorkspaceSnapshot, selectWorkspaceRoot } from './workspace-files.cjs'
import type { WorkspaceRoot } from './workspace-files.cjs'
import { WorkspaceError } from './workspace-format.cjs'

export type WorkspaceOwner = { windowId: number; frame: object }
type Connection = { owner: WorkspaceOwner; root: WorkspaceRoot; connection: WorkspaceConnection }
export type WorkspaceBridge = Pick<DesktopDataApi['workspace'], 'open' | 'create' | 'snapshot' | 'release'>

/** Main만 네이티브 선택 경로를 공급합니다. Renderer 요청에는 경로를 받지 않습니다. */
export class WorkspaceService {
  private readonly connections = new Map<string, Connection>()
  private readonly selecting = new Set<number>()
  constructor(private readonly database: PersonalDatabase, private readonly selectFolder: (owner: WorkspaceOwner) => Promise<string | null>, private readonly isCurrent: (owner: WorkspaceOwner) => boolean) {}
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
