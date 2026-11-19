import type { SampleRequest } from '../workspace/types'

export type ApiSaveHistory = {
  id: string
  savedAt: string
  presetName: string
  request: SampleRequest
}

// 입력 객체는 깊게 복사하고, 변경할 수 없는 File은 메모리 참조로 보관합니다.
export function copyHistoryRequest(request: SampleRequest): SampleRequest {
  const copied: SampleRequest = structuredClone({ ...request, multipartFiles: undefined })
  if (request.multipartFiles) {
    copied.multipartFiles = Object.fromEntries(Object.entries(request.multipartFiles).map(([id, selection]) => [id, { ...selection }]))
  }
  return copied
}

// 이력은 폼 내용만 복원하며 현재 API의 식별자·이름·컬렉션 위치는 유지합니다.
export function restoreHistoryRequest(current: SampleRequest, saved: SampleRequest): SampleRequest {
  return { ...copyHistoryRequest(saved), id: current.id, name: current.name, collectionId: current.collectionId, folderId: current.folderId }
}
