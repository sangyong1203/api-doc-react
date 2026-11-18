import { lazy, Suspense, useId } from 'react'
import type { SampleRequest } from '@/features/workspace/types'

const JsonEditor = lazy(() => import('@/features/api-editor/components/JsonEditor').then((module) => ({ default: module.JsonEditor })))

export function ApiDocumentationEditor({ request, onChange }: { request: SampleRequest; onChange: (request: SampleRequest) => void }) {
  const descriptionId = useId()
  const document = request.documentation ?? { description: '', requestExample: '', responseExample: '' }
  function update(key: keyof typeof document, value: string) {
    onChange({ ...request, documentation: { ...document, [key]: value } })
  }
  return <div className="api-documentation-editor space-y-5 p-1">
    <Suspense fallback={<p>편집기 준비 중…</p>}>
      <p className="text-xs text-muted-foreground">설명과 예시는 API 공통 정보입니다. 저장 버튼으로 메모리에 보관하며 새로고침하면 초기화됩니다.</p>
      <section className="document-description-editor space-y-2">
        <label htmlFor={descriptionId} className="font-semibold">설명</label>
        <textarea id={descriptionId} className="document-description-input min-h-40 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label="API 문서 설명" placeholder="API 설명을 입력하세요." value={document.description} onChange={(event) => update('description', event.target.value)} />
      </section>
      <section className="document-request-example-editor space-y-2"><h2 className="font-semibold">요청 예시</h2><JsonEditor label="문서 요청 예시" initialValue={document.requestExample} onChange={(value) => update('requestExample', value)} /></section>
      <section className="document-response-example-editor space-y-2"><h2 className="font-semibold">성공 응답 예시</h2><p className="text-xs text-muted-foreground">문서에 공개할 예시를 직접 작성하세요. 실행 결과는 자동으로 추가하지 않습니다.</p><JsonEditor label="문서 응답 예시" initialValue={document.responseExample} onChange={(value) => update('responseExample', value)} /></section>
    </Suspense>
  </div>
}
