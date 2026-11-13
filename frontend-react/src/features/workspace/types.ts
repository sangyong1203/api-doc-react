export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type WorkspaceCollection = { id: string; name: string }
export type WorkspaceFolder = { id: string; collectionId: string; name: string }

export type RequestField = {
  id: string
  enabled: boolean
  name: string
  value: string
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
  body: string
  pathParams: Array<Pick<RequestField, 'name' | 'value'>>
  queryParams: Array<Pick<RequestField, 'name' | 'value'>>
  headers: Array<Pick<RequestField, 'name' | 'value'>>
}

export type WorkspaceTab = {
  request: SampleRequest
  saved: SampleRequest
  execution: ExecutionState
  requestSnapshot: RequestSnapshot | null
}
