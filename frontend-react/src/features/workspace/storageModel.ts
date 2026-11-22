import type { WorkspaceConnection, WorkspaceSnapshot } from '@/types/desktopData'
import type { BodyField, FieldSpec, HttpMethod, RequestField, SampleRequest, Workspace, WorkspaceCollection, WorkspaceFolder } from './types'
import type { PayloadPreset } from '@/features/payload-presets/types'
import type { Environment } from '@/features/environments/types'

// Main에서 공유 v1 검증을 마친 snapshot의 화면 변환 전용입니다. 원본 JSON은 별도로 유지합니다.
type Field = { id: string; name: string; type: FieldSpec['type']; required: boolean; description: string; arrayFormat?: 'repeat' | 'comma' }
type Cell = { enabled: boolean; value?: string; secretRef?: string }
type Values = {
  path: Record<string, Cell>; query: Record<string, Cell>; headers: Record<string, Cell>
  body: { fields: Record<string, string | { secretRef: string }>; enabled: Record<string, boolean> }
  multipart: Record<string, Cell>
}
type StoredApi = {
  id: string; name: string; method: HttpMethod; url: string
  request: { path: Field[]; query: Field[]; headers: Field[]; body: { format: 'json' | 'multipart'; json: BodyField[]; multipart: Field[] } }
  response: { success: BodyField[]; errors: SampleRequest['errorResponses'] }
  documentation: NonNullable<SampleRequest['documentation']>
  defaultPresetId: string
  presets: Array<{ id: string; name: string; description: string; values: Values }>
}
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
