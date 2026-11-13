import type { RequestField, SampleRequest } from '@/features/workspace/types'

type FieldValue = Pick<RequestField, 'id' | 'enabled' | 'value'>
export type PayloadValues = {
  pathParams: FieldValue[]
  queryParams: FieldValue[]
  headers: FieldValue[]
  body: string
  multipartFields?: FieldValue[]
  multipartFiles?: SampleRequest['multipartFiles']
  bodyView?: 'json' | 'fields'
  bodyValues?: Record<string, string>
}
export type PayloadPreset = { id: string; name: string; description: string; values: PayloadValues }

// 세트에는 값과 사용 여부만 보관합니다. 키·타입·설명·구조는 API 명세가 소유합니다.
export function copyPayload(request: PayloadValues): PayloadValues {
  const fields = (rows: FieldValue[]) => rows.map(({ id, enabled, value }) => ({ id, enabled, value }))
  const copied = structuredClone({ pathParams: fields(request.pathParams), queryParams: fields(request.queryParams), headers: fields(request.headers), body: request.body, bodyView: request.bodyView, bodyValues: request.bodyValues, multipartFields: fields(request.multipartFields ?? []) })
  return { ...copied, multipartFiles: { ...request.multipartFiles } }
}

export function applyPayload(request: SampleRequest, values: PayloadValues): SampleRequest {
  const merge = (rows: RequestField[], inputs: FieldValue[]) => rows.map((row) => {
    const input = inputs.find((item) => item.id === row.id)
    return { ...row, value: input?.value ?? '', enabled: input?.enabled ?? true }
  })
  return { ...request, pathParams: merge(request.pathParams, values.pathParams), queryParams: merge(request.queryParams, values.queryParams), headers: merge(request.headers, values.headers), body: values.body, bodyView: values.bodyView, bodyValues: structuredClone(values.bodyValues), multipartFields: merge(request.multipartFields ?? [], values.multipartFields ?? []), multipartFiles: { ...values.multipartFiles } }
}
