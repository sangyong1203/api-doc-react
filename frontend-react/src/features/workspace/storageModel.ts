import type { SharedApi, SharedValues, WorkspaceConnection, WorkspaceSnapshot } from '@/types/desktopData'
import type { RequestField, SampleRequest, Workspace, WorkspaceCollection, WorkspaceFolder } from './types'
import type { PayloadPreset } from '@/features/payload-presets/types'
import type { Environment } from '@/features/environments/types'

// Main에서 공유 v1 검증을 마친 snapshot의 화면 변환 전용입니다. 원본 JSON은 별도로 유지합니다.
type Field = SharedApi['request']['path'][number]
type Cell = SharedValues['path'][string]
type StoredApi = SharedApi
export type FolderWorkspace = {
  workspace: Workspace; connection: WorkspaceConnection; snapshot: WorkspaceSnapshot
  collections: WorkspaceCollection[]; folders: WorkspaceFolder[]; requests: SampleRequest[]
  presetsByApi: Record<string, PayloadPreset[]>; defaultPresets: Record<string, string>; environments: Environment[]; hasSecretRefs: boolean
}

/** 비밀 참조는 실제값으로 변환하지 않습니다. 원본 snapshot과 경고를 유지하고 화면 입력은 미입력으로 표시합니다. */
export function decodeFolderWorkspace(connection: WorkspaceConnection, snapshot: WorkspaceSnapshot): FolderWorkspace {
  const manifest = JSON.parse(snapshot.workspace.json) as { collections: Array<WorkspaceCollection & { apiIds: string[]; folders: Array<{ id: string; name: string; apiIds: string[] }> }>; environmentIds: string[] }
  const collections = manifest.collections.map(({ id, name }) => ({ id, name }))
  const folders = manifest.collections.flatMap(collection => collection.folders.map(folder => ({ id: folder.id, name: folder.name, collectionId: collection.id })))
  const locations = new Map<string, { collectionId: string; folderId: string | null }>()
  const order: string[] = []
  for (const collection of manifest.collections) {
    for (const id of collection.apiIds) { locations.set(id, { collectionId: collection.id, folderId: null }); order.push(id) }
    for (const folder of collection.folders) { for (const id of folder.apiIds) { locations.set(id, { collectionId: collection.id, folderId: folder.id }); order.push(id) } }
  }
  const apis = new Map(snapshot.apis.map(doc => { const api = JSON.parse(doc.json) as StoredApi; return [api.id, api] }))
  let hasSecretRefs = false
  const rows = (fields: Field[], cells: Record<string, Cell>): RequestField[] => fields.map(field => {
    const cell = cells[field.id]
    if (cell?.secretRef) { hasSecretRefs = true }
    return { id: field.id, name: field.name, enabled: cell?.enabled ?? true, value: cell?.value ?? '' }
  })
  const presetsByApi: Record<string, PayloadPreset[]> = {}, defaultPresets: Record<string, string> = {}
  const requests = order.map(id => {
    const api = apis.get(id)!
    const fields = Object.fromEntries([...api.request.path, ...api.request.query, ...api.request.headers, ...api.request.body.multipart]
      .map(field => [field.id, { type: field.type, required: field.required, description: field.description, queryArrayFormat: field.arrayFormat }]))
    presetsByApi[id] = api.presets.map(preset => {
      const bodyValues = Object.fromEntries(Object.entries(preset.values.body.fields).map(([id, value]) => {
        if (typeof value !== 'string') { hasSecretRefs = true }
        return [id, typeof value === 'string' ? value : '']
      }))
      return { id: preset.id, name: preset.name, description: preset.description, values: {
        pathParams: rows(api.request.path, preset.values.path), queryParams: rows(api.request.query, preset.values.query), headers: rows(api.request.headers, preset.values.headers),
        body: '', bodyView: 'fields', bodyValues, bodyEnabled: preset.values.body.enabled, multipartFields: rows(api.request.body.multipart, preset.values.multipart),
      } }
    })
    defaultPresets[id] = api.defaultPresetId
    const selected = presetsByApi[id].find(preset => preset.id === api.defaultPresetId)!
    // 세트 값에 공통 행 이름을 붙여 기존 입력·전환 처리에 전달합니다.
    return { id, name: api.name, ...locations.get(id)!, method: api.method, url: api.url, documentation: api.documentation,
      pathParams: rows(api.request.path, api.presets.find(p => p.id === selected.id)!.values.path),
      queryParams: rows(api.request.query, api.presets.find(p => p.id === selected.id)!.values.query),
      headers: rows(api.request.headers, api.presets.find(p => p.id === selected.id)!.values.headers),
      multipartFields: rows(api.request.body.multipart, api.presets.find(p => p.id === selected.id)!.values.multipart),
      body: '', bodyFormat: api.request.body.format, bodyValues: selected.values.bodyValues, bodyEnabled: selected.values.bodyEnabled,
      schema: { fields, body: api.request.body.json }, responseFields: api.response.success, errorResponses: api.response.errors.map(error => ({ ...error, fields: error.fields.map(field => ({ ...field })) })),
    } satisfies SampleRequest
  })
  const envs = new Map(snapshot.environments.map(doc => { const env = JSON.parse(doc.json) as { id: string; name: string; variables: Array<RequestField & { secretRef?: string }> }; return [env.id, env] }))
  const environments = manifest.environmentIds.map(id => {
    const env = envs.get(id)!
    return { ...env, variables: env.variables.map(variable => { if (variable.secretRef) { hasSecretRefs = true }
      return { id: variable.id, name: variable.name, enabled: variable.enabled, value: variable.value ?? '' } }) }
  })
  return { workspace: { id: `${connection.localFolderId}:${connection.workspaceId}`, name: connection.name }, connection, snapshot, collections, folders, requests, presetsByApi, defaultPresets, environments, hasSecretRefs }
}

/** 기존 API의 공통 명세와 선택 세트만 공유 DTO로 구성합니다. 화면 객체 전체를 전송하지 않습니다. */
export function encodeApiEdit(snapshot: WorkspaceSnapshot, request: SampleRequest, selectedPresetId: string): SharedApi {
  const document = snapshot.apis.find(document => document.id === request.id)
  if (!document) { throw new Error('저장할 API 원본을 찾을 수 없습니다.') }
  const api = JSON.parse(document.json) as SharedApi
  const selected = api.presets.find(preset => preset.id === selectedPresetId)
  if (!selected) { throw new Error('저장할 입력 세트를 선택하세요.') }
  const spec = (row: RequestField, query = false, path = false) => {
    const field = request.schema?.fields[row.id]
    return { id: row.id, name: row.name, type: field?.type ?? 'string', required: path || (field?.required ?? false), description: field?.description ?? '',
      ...(query ? { arrayFormat: field?.queryArrayFormat ?? 'repeat' } : {}) }
  }
  const rows = (rows: RequestField[], originals: Record<string, Cell>, fileFields = false) => Object.fromEntries(rows.map(row => {
    const old = originals[row.id]
    if (old?.secretRef && row.value !== '') { throw new Error('비밀 참조의 실제값은 공유 파일에 저장할 수 없습니다. 해당 입력을 비운 뒤 저장해 주세요.') }
    return [row.id, fileFields && request.schema?.fields[row.id]?.type === 'file' ? { enabled: row.enabled }
      : old?.secretRef ? { enabled: row.enabled, secretRef: old.secretRef } : { enabled: row.enabled, value: row.value }]
  }))
  const body = request.schema?.body ?? []
  const bodyFields = Object.fromEntries(body.filter(field => !['object', 'array', 'object array'].includes(field.type)).map(field => {
    const old = selected.values.body.fields[field.id], value = request.bodyValues?.[field.id] ?? ''
    if (typeof old === 'object' && value !== '') { throw new Error('비밀 참조의 실제값은 공유 파일에 저장할 수 없습니다. 해당 입력을 비운 뒤 저장해 주세요.') }
    return [field.id, typeof old === 'object' ? { secretRef: old.secretRef } : value]
  }))
  const allowed = (values: SharedValues): SharedValues => {
    const pick = <T,>(map: Record<string, T>, ids: string[]) => Object.fromEntries(Object.entries(map).filter(([id]) => ids.includes(id)))
    return { path: pick(values.path, request.pathParams.map(row => row.id)), query: pick(values.query, request.queryParams.map(row => row.id)), headers: pick(values.headers, request.headers.map(row => row.id)),
      body: { fields: pick(values.body.fields, body.map(field => field.id)), enabled: pick(values.body.enabled, body.map(field => field.id)) }, multipart: pick(values.multipart, (request.multipartFields ?? []).map(row => row.id)) }
  }
  const values: SharedValues = { path: rows(request.pathParams, selected.values.path), query: rows(request.queryParams, selected.values.query), headers: rows(request.headers, selected.values.headers),
    body: { fields: bodyFields, enabled: Object.fromEntries(Object.entries(request.bodyEnabled ?? {}).filter(([id]) => body.some(field => field.id === id))) }, multipart: rows(request.multipartFields ?? [], selected.values.multipart, true) }
  return { formatVersion: 1, id: api.id, name: api.name, method: request.method, url: request.url,
    request: { path: request.pathParams.map(row => spec(row, false, true)), query: request.queryParams.map(row => spec(row, true)), headers: request.headers.map(row => spec(row)),
      body: { format: request.bodyFormat ?? 'json', json: body.map(({ id, name, type, required, description, parentId }) => ({ id, name, type, required, description, parentId })), multipart: (request.multipartFields ?? []).map(row => spec(row)) } },
    response: { success: (request.responseFields ?? []).map(({ id, name, type, required, description, parentId }) => ({ id, name, type, required, description, parentId })),
      errors: request.errorResponses.map(({ id, name, status, description, fields }) => ({ id, name, status, description, fields: fields.map(({ id, name, enabled, value }) => ({ id, name, enabled, value })) })) },
    documentation: { description: request.documentation?.description ?? '', requestExample: request.documentation?.requestExample ?? '', responseExample: request.documentation?.responseExample ?? '' },
    defaultPresetId: api.defaultPresetId, presets: api.presets.map(preset => ({ id: preset.id, name: preset.name, description: preset.description, values: preset.id === selectedPresetId ? values : allowed(preset.values) })) }
}
