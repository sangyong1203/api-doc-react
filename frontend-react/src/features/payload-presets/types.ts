import type { SampleRequest } from '@/features/workspace/types'

export type PayloadValues = Pick<SampleRequest, 'pathParams' | 'queryParams' | 'headers' | 'body'>
export type PayloadPreset = { id: string; name: string; description: string; values: PayloadValues }

// 요청 입력의 복사본만 보관해 이후 편집과 세트가 서로 영향을 주지 않게 합니다.
export function copyPayload(request: PayloadValues): PayloadValues {
  return structuredClone({ pathParams: request.pathParams, queryParams: request.queryParams, headers: request.headers, body: request.body })
}
