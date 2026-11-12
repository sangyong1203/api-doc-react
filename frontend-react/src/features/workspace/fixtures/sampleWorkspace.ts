import type { HttpMethod, SampleOutcome, SampleRequest, SampleResponse } from '../types'

export const SAMPLE_REQUESTS: SampleRequest[] = [
  {
    id: 'robots-list', name: '로봇 목록 조회', folder: '로봇 관리', method: 'GET',
    url: '{{baseUrl}}/robots',
    params: [{ id: 'page', enabled: true, name: 'page', value: '1' }, { id: 'limit', enabled: true, name: 'limit', value: '20' }],
    headers: [{ id: 'accept', enabled: true, name: 'Accept', value: 'application/json' }], body: '',
  },
  {
    id: 'robots-create', name: '로봇 등록', folder: '로봇 관리', method: 'POST',
    url: '{{baseUrl}}/robots', params: [],
    headers: [{ id: 'content-type', enabled: true, name: 'Content-Type', value: 'application/json' }],
    body: JSON.stringify({ robotId: 'robot-003', name: '배송 로봇 C', zone: 'C-01' }, null, 2),
  },
  {
    id: 'robots-detail', name: '로봇 상세 조회', folder: '로봇 관리', method: 'GET',
    url: '{{baseUrl}}/robots/robot-001', params: [], headers: [], body: '',
  },
  {
    id: 'health', name: '서비스 상태 확인', folder: '시스템', method: 'GET',
    url: '{{baseUrl}}/health', params: [], headers: [], body: '',
  },
]

// 입력을 서버로 전송하지 않고, 실행 시작 시 선택한 시나리오의 고정 응답을 만듭니다.
export function createSampleResponse(requestId: string, method: HttpMethod, outcome: SampleOutcome): SampleResponse {
  const isHttpError = outcome === 'http-error'
  const status = isHttpError ? 422 : method === 'POST' ? 201 : 200
  let data: unknown = { robotId: 'robot-001', name: '배송 로봇 A', zone: 'A-01', status: 'online' }
  if (requestId === 'robots-list') {
    data = { items: [data, { robotId: 'robot-002', name: '배송 로봇 B', zone: 'B-02', status: 'idle' }], total: 2, page: 1 }
  } else if (requestId === 'health') {
    data = { status: 'ok', service: 'robot-api' }
  } else if (requestId === 'robots-create') {
    data = { robotId: 'robot-003', name: '배송 로봇 C', zone: 'C-01', status: 'created' }
  }
  const body = method === 'HEAD' ? '' : JSON.stringify(isHttpError ? { code: 'VALIDATION_ERROR', message: '샘플 요청의 입력값을 확인해 주세요.' } : data, null, 2)
  return {
    status, statusText: isHttpError ? 'Unprocessable Entity' : status === 201 ? 'Created' : 'OK',
    body, headers: 'content-type: application/json; charset=utf-8\nx-apidoc-mode: sample',
    durationMs: 128, sizeBytes: new TextEncoder().encode(body).length,
  }
}
