import { useState } from 'react'
import { ArrowDownToLine, CircleAlert, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ExecutionState } from '@/features/workspace/types'

export function ResponseViewer({ execution }: { execution: ExecutionState }) {
  const [section, setSection] = useState('body')

  return (
    <section className="response-viewer" aria-label="응답 결과" aria-busy={execution.status === 'running'}>
      <Card className="response-board" size="sm">
        <CardContent>
          <div className="response-heading">
            <h2 className="response-title">응답 <Badge variant="secondary">SAMPLE</Badge></h2>
            {execution.status === 'complete' && (
              <div className="response-metrics">
                <Badge
                  variant={execution.response.status >= 400 ? 'destructive' : 'outline'}
                  className={execution.response.status < 400 ? 'status-success' : undefined}
                >
                  {execution.response.status} {execution.response.statusText}
                </Badge>
                <Badge variant="outline">{execution.response.durationMs} ms</Badge>
                <Badge variant="outline">{execution.response.sizeBytes} B</Badge>
              </div>
            )}
          </div>
          <div className="sr-only" role="status">
            {execution.status === 'complete' ? `샘플 실행 완료: ${execution.response.status}`
              : execution.status === 'running' ? '샘플 실행 중'
              : execution.status === 'cancelled' ? '샘플 실행 취소됨'
              : execution.status === 'error' ? execution.message : ''}
          </div>
          {execution.status === 'complete' ? (
            <>
              <Tabs className="response-tabs" value={section} onValueChange={setSection}>
                <TabsList aria-label="응답 보기">
                  <TabsTrigger value="body">Body</TabsTrigger>
                  <TabsTrigger value="headers">Headers</TabsTrigger>
                </TabsList>
                <TabsContent value="body">
                  <pre className="response-code"><code>{execution.response.body || '(본문 없음)'}</code></pre>
                </TabsContent>
                <TabsContent value="headers">
                  <pre className="response-code"><code>{execution.response.headers}</code></pre>
                </TabsContent>
              </Tabs>
            </>
          ) : execution.status === 'error' ? (
            <Alert className="response-error" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>샘플 통신 오류</AlertTitle>
              <AlertDescription>{execution.message}</AlertDescription>
            </Alert>
          ) : (
            <Empty className="response-placeholder p-3">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {execution.status === 'running'
                    ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
                    : <ArrowDownToLine aria-hidden="true" />}
                </EmptyMedia>
                <EmptyTitle>
                  {execution.status === 'running' ? '샘플 응답 준비 중'
                    : execution.status === 'cancelled' ? '샘플 실행이 취소되었습니다'
                    : '응답을 확인할 준비가 되었습니다'}
                </EmptyTitle>
                <EmptyDescription>
                  {execution.status === 'running' ? '취소 버튼으로 실행을 중단할 수 있습니다.'
                    : '샘플 실행을 누르면 선택한 시나리오의 응답을 표시합니다.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
