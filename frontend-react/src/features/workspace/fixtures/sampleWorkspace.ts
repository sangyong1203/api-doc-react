import type { HttpMethod, SampleRequest, SampleResponse, WorkspaceCollection, WorkspaceFolder } from '../types'

export const SAMPLE_COLLECTIONS: WorkspaceCollection[] = [{ id: 'robot-api', name: 'Robot API' }]
export const SAMPLE_FOLDERS: WorkspaceFolder[] = [
  { id: 'robots', collectionId: 'robot-api', name: '로봇 관리' },
  { id: 'system', collectionId: 'robot-api', name: '시스템' },
]

export const SAMPLE_REQUESTS: SampleRequest[] = [
  {
    id: 'robots-list', name: '로봇 목록 조회', collectionId: 'robot-api', folderId: 'robots', method: 'GET',
    url: '{{baseUrl}}/robots',
    errorResponses: [],
    pathParams: [],
    queryParams: [{ id: 'page', enabled: true, name: 'page', value: '1' }, { id: 'limit', enabled: true, name: 'limit', value: '20' }],
    headers: [{ id: 'accept', enabled: true, name: 'Accept', value: 'application/json' }], body: '',
  },
  {
    id: 'robots-create', name: '로봇 등록', collectionId: 'robot-api', folderId: 'robots', method: 'POST',
    url: '{{baseUrl}}/robots', pathParams: [], queryParams: [],
    errorResponses: [],
    headers: [{ id: 'content-type', enabled: true, name: 'Content-Type', value: 'application/json' }],
    body: JSON.stringify({ robotId: 'robot-003', name: '배송 로봇 C', zone: 'C-01' }, null, 2),
  },
  {
    id: 'robots-detail', name: '로봇 상세 조회', collectionId: 'robot-api', folderId: 'robots', method: 'GET',
    url: '{{baseUrl}}/robots/robot-001',
    errorResponses: [],
    pathParams: [{ id: 'robot-id', enabled: true, name: 'robotId', value: 'robot-001' }],
    queryParams: [], headers: [], body: '',
  },
  {
    id: 'health', name: '서비스 상태 확인', collectionId: 'robot-api', folderId: 'system', method: 'GET',
    url: '{{baseUrl}}/health', pathParams: [], queryParams: [], headers: [], body: '',
    errorResponses: [],
  },
]

// 입력을 서버로 전송하지 않고 API별 고정 성공 응답을 만듭니다.
export function createSampleResponse(requestId: string, method: HttpMethod): SampleResponse {
  const status = method === 'POST' ? 201 : 200
  let data: unknown = { robotId: 'robot-001', name: '배송 로봇 A', zone: 'A-01', status: 'online' }
  if (requestId === 'robots-list') {
    data = { items: [data, { robotId: 'robot-002', name: '배송 로봇 B', zone: 'B-02', status: 'idle' }], total: 2, page: 1 }
  } else if (requestId === 'health') {
    data = { status: 'ok', service: 'robot-api' }
  } else if (requestId === 'robots-create') {
    data = { robotId: 'robot-003', name: '배송 로봇 C', zone: 'C-01', status: 'created' }
  }
  const body = method === 'HEAD' ? '' : JSON.stringify(data, null, 2)
  return {
    status, statusText: status === 201 ? 'Created' : 'OK',
    body, headers: 'content-type: application/json; charset=utf-8\nx-apidoc-mode: sample',
    durationMs: 128, sizeBytes: new TextEncoder().encode(body).length,
  }
}
