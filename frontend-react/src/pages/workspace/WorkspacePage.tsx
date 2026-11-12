import { lazy, Suspense, useState } from 'react'
import { Braces, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

const JsonEditor = lazy(() =>
  import('@/features/api-editor/components/JsonEditor').then((module) => ({ default: module.JsonEditor })),
)

const SAMPLE_PAYLOAD = JSON.stringify({ robotId: 'robot-001', name: '테스트 로봇' }, null, 2)

export function WorkspacePage() {
  const [editorVersion, setEditorVersion] = useState(0)

  return (
    <main className="workspace-page mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="workspace-header flex items-center gap-3">
        <Braces className="size-8" aria-hidden="true" />
        <div className="workspace-heading">
          <h1 className="text-2xl font-semibold tracking-tight">API Doc</h1>
          <p className="mt-1 text-sm text-muted-foreground">개발 환경 연결 확인</p>
        </div>
      </header>

      <section className="editor-preview rounded-lg border bg-background p-6" aria-labelledby="editor-title">
        <div className="editor-toolbar mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="editor-heading">
            <h2 id="editor-title" className="font-semibold">JSON 편집기</h2>
            <p className="mt-1 text-sm text-muted-foreground">화면 확인용 샘플 데이터입니다.</p>
          </div>
          <Button variant="outline" onClick={() => setEditorVersion((version) => version + 1)}>
            <RotateCcw aria-hidden="true" />
            샘플 복원
          </Button>
        </div>
        <Suspense fallback={<p className="text-sm text-muted-foreground" role="status">편집기 준비 중…</p>}>
          <JsonEditor key={editorVersion} initialValue={SAMPLE_PAYLOAD} label="샘플 요청 JSON" />
        </Suspense>
      </section>
    </main>
  )
}
