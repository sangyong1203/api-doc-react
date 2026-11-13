export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type WorkspaceCollection = { id: string; name: string }
export type WorkspaceFolder = { id: string; collectionId: string; name: string }

export type RequestField = {
  id: string
  enabled: boolean
  name: string
  value: string
}

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'string array' | 'number array' | 'boolean array' | 'object array' | 'null' | 'file'
export type FieldSpec = { required: boolean; type: FieldType; description: string; queryArrayFormat?: 'repeat' | 'comma' }
export type BodyField = FieldSpec & { id: string; parentId: string | null; name: string }
export type RequestSchema = {
  fields: Record<string, FieldSpec>
  body: BodyField[]
}

export type ErrorResponseExample = {
  id: string
  name: string
  status: string
  description: string
  fields: RequestField[]
}

export type SampleRequest = {
  id: string
  name: string
  collectionId: string
  folderId: string | null
  method: HttpMethod
  url: string
  pathParams: RequestField[]
  queryParams: RequestField[]
  headers: RequestField[]
  body: string
  bodyFormat?: 'json' | 'multipart'
  multipartFields?: RequestField[]
  // 브라우저에서 선택한 파일은 세트별 메모리 상태이며 공유 파일에 직렬화하지 않습니다.
  multipartFiles?: Record<string, { selectionId: string; file: File }>
  responseFields?: BodyField[]
  schema?: RequestSchema
  bodyView?: 'json' | 'fields'
  bodyValues?: Record<string, string>
  errorResponses: ErrorResponseExample[]
}

export type SampleResponse = {
  status: number
  statusText: string
  body: string
  headers: string
  durationMs: number
  sizeBytes: number
}

export type ExecutionState =
  | { status: 'idle' | 'running' | 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'complete'; response: SampleResponse }

export type RequestSnapshot = {
  queryString?: string
  bodyFormat?: 'json' | 'multipart'
  body: string
  pathParams: Array<Pick<RequestField, 'name' | 'value'>>
  queryParams: Array<Pick<RequestField, 'name' | 'value'>>
  headers: Array<Pick<RequestField, 'name' | 'value'>>
}

export type WorkspaceTab = {
  request: SampleRequest
  selectedPresetId: string | null
  saved: SampleRequest
  execution: ExecutionState
  requestSnapshot: RequestSnapshot | null
}
