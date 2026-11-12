export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type RequestField = {
  id: string
  enabled: boolean
  name: string
  value: string
}

export type SampleRequest = {
  id: string
  name: string
  folder: string
  method: HttpMethod
  url: string
  params: RequestField[]
  headers: RequestField[]
  body: string
}

export type SampleOutcome = 'success' | 'http-error' | 'network-error'

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

export type WorkspaceTab = {
  request: SampleRequest
  saved: SampleRequest
  execution: ExecutionState
}
