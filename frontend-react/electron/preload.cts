import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopRequest, DesktopResult, WorkspaceSnapshot } from '../src/types/desktopData.js'
import type { DesktopBridge } from '../src/types/desktop.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const hashPattern = /^sha256:[0-9a-f]{64}$/
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function uuid(value: unknown): value is string { return typeof value === 'string' && uuidPattern.test(value) }
function keys(value: Record<string, unknown>, names: string[]): boolean { return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)) }
function snapshot(value: unknown): value is WorkspaceSnapshot {
  if (!plain(value) || !keys(value, ['revision', 'workspace', 'apis', 'environments']) || typeof value.revision !== 'string' || !hashPattern.test(value.revision)
    || !Array.isArray(value.apis) || !Array.isArray(value.environments) || value.apis.length + value.environments.length > 999) { return false }
  let bytes = 0
  const document = (data: unknown, kind: string) => {
    if (!plain(data) || !keys(data, ['kind', 'id', 'json', 'hash']) || data.kind !== kind || !uuid(data.id)
      || typeof data.json !== 'string' || typeof data.hash !== 'string' || !hashPattern.test(data.hash)) { return false }
    const size = new TextEncoder().encode(data.json).byteLength
    bytes += size
    return size <= 8 * 1024 * 1024 && bytes <= 64 * 1024 * 1024
  }
  return document(value.workspace, 'workspace') && value.apis.every(doc => document(doc, 'api')) && value.environments.every(doc => document(doc, 'environment'))
}
function selection(value: unknown): boolean {
  if (!plain(value)) { return false }
  if (value.status === 'cancelled') { return keys(value, ['status']) }
  if (value.status !== 'opened' || !keys(value, ['status', 'connection', 'snapshot']) || !plain(value.connection)) { return false }
  const connection = value.connection
  return keys(connection, ['handle', 'localFolderId', 'workspaceId', 'name']) && uuid(connection.handle) && uuid(connection.localFolderId)
    && uuid(connection.workspaceId) && typeof connection.name === 'string' && snapshot(value.snapshot) && value.snapshot.workspace.id === connection.workspaceId
}
const errorCodes = new Set(['INVALID_REQUEST', 'ACCESS_DENIED', 'WORKSPACE_NOT_OPEN', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_ALREADY_EXISTS', 'DOCUMENT_INVALID', 'FORMAT_UNSUPPORTED', 'PATH_NOT_ALLOWED', 'FILE_CONFLICT', 'FILE_READ_FAILED', 'FILE_WRITE_FAILED', 'PAYLOAD_TOO_LARGE', 'BUSY', 'OPERATION_ID_REUSED', 'WORKSPACE_RECOVERY_REQUIRED', 'DATABASE_UNAVAILABLE', 'INTERNAL_ERROR'])
function committed(value: unknown): boolean {
  return plain(value) && keys(value, ['operationId', 'revision', 'documents', 'history']) && uuid(value.operationId) && typeof value.revision === 'string' && hashPattern.test(value.revision)
    && ['recorded', 'not-required', 'failed', 'unknown'].includes(String(value.history)) && Array.isArray(value.documents) && value.documents.length <= 1000
    && value.documents.every(document => plain(document) && keys(document, ['kind', 'id', 'hash']) && ['workspace', 'api', 'environment'].includes(String(document.kind)) && uuid(document.id)
      && (document.hash === null || typeof document.hash === 'string' && hashPattern.test(document.hash)))
}
function commitStatus(value: unknown): boolean {
  if (!plain(value)) { return false }
  if (value.status === 'pending' || value.status === 'unknown') { return keys(value, ['status']) }
  if (value.status === 'committed') { return keys(value, ['status', 'result']) && committed(value.result) }
  return value.status === 'failed' && keys(value, ['status', 'error']) && plain(value.error) && keys(value.error, ['code', 'message'])
    && errorCodes.has(String(value.error.code)) && typeof value.error.message === 'string' && value.error.message.length <= 512
}
/** 고정 채널만 호출하고 응답의 추적 ID·형식을 확인합니다. 네이티브 선택 대기에는 timeout을 두지 않습니다. */
async function workspaceCall<T>(channel: 'workspace:open' | 'workspace:create' | 'workspace:snapshot' | 'workspace:release' | 'workspace:commit' | 'workspace:commit-status', request: DesktopRequest<unknown>, validate: (value: unknown) => boolean): Promise<DesktopResult<T>> {
  const requestId = plain(request) && uuid(request.requestId) ? request.requestId : crypto.randomUUID()
  const fail = (code: 'INVALID_REQUEST' | 'IPC_UNAVAILABLE' | 'IPC_TIMEOUT'): DesktopResult<T> => ({ requestId, ok: false, error: { code, message: code === 'INVALID_REQUEST' ? '작업 폴더 요청을 확인해 주세요.' : code === 'IPC_TIMEOUT' ? '작업 폴더 응답을 확인할 수 없습니다. 다시 조회해 주세요.' : '작업 폴더 연결을 확인할 수 없습니다.' } })
  if (!plain(request) || !keys(request, ['requestId', 'payload']) || !uuid(request.requestId)) { return fail('INVALID_REQUEST') }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const response: unknown = await Promise.race([
      ipcRenderer.invoke(channel, request),
      new Promise<DesktopResult<T>>(resolve => { if (channel !== 'workspace:open' && channel !== 'workspace:create') { timer = setTimeout(() => resolve(fail('IPC_TIMEOUT')), channel === 'workspace:commit' ? 30000 : 15000) } }),
    ])
    if (!plain(response) || response.requestId !== requestId || typeof response.ok !== 'boolean') { return fail('IPC_UNAVAILABLE') }
    if (response.ok) {
      if (!keys(response, ['requestId', 'ok', 'data']) || !validate(response.data)) { return fail('IPC_UNAVAILABLE') }
    } else if (!keys(response, ['requestId', 'ok', 'error']) || !plain(response.error) || !keys(response.error, ['code', 'message'])
      || typeof response.error.code !== 'string' || (!errorCodes.has(response.error.code) && response.error.code !== 'IPC_TIMEOUT')
      || typeof response.error.message !== 'string' || response.error.message.length > 512) { return fail('IPC_UNAVAILABLE') }
    return response as DesktopResult<T>
  } catch { return fail('IPC_UNAVAILABLE') } finally { clearTimeout(timer) }
}

const workspaceBridge: DesktopBridge['workspace'] = {
  open: request => workspaceCall('workspace:open', request, selection),
  create: request => workspaceCall('workspace:create', request, selection),
  snapshot: request => workspaceCall('workspace:snapshot', request, snapshot),
  commit: request => workspaceCall('workspace:commit', request, committed),
  commitStatus: request => workspaceCall('workspace:commit-status', request, commitStatus),
  release: request => workspaceCall('workspace:release', request, value => value === null),
}
const bridge: DesktopBridge = {
  workspace: Object.freeze(workspaceBridge),
  versions: Object.freeze({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }),
  onCloseRequested(listener) {
    const receive = (_event: Electron.IpcRendererEvent, requestId: unknown) => {
      if (typeof requestId === 'string') { listener(requestId) }
    }
    ipcRenderer.on('app:close-request', receive)
    return () => { ipcRenderer.removeListener('app:close-request', receive) }
  },
  respondToClose(requestId, state) {
    ipcRenderer.send('app:close-state', requestId, { dirty: state.dirty, running: state.running })
  },
}

contextBridge.exposeInMainWorld('apidocDesktop', bridge)
