import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { SampleRequest } from '@/features/workspace/types'
import { ApiDocumentation } from './ApiDocumentation'
import { downloadApiDocument } from '../downloadApiDocument'

type Props = {
  request: SampleRequest
  dirty: boolean
  error?: string
  onChange: (request: SampleRequest) => void
  onSave: () => void
  onClose: () => void
}

export function ApiDocumentationDialog({ request, dirty, error, onChange, onSave, onClose }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  async function download() {
    setDownloading(true)
    setDownloadError('')
    try { await downloadApiDocument(request) }
    catch { setDownloadError('문서를 다운로드하지 못했습니다. 다시 시도해 주세요.') }
    finally { setDownloading(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) { onClose() } }}>
    <DialogContent className="api-document-dialog flex h-[90dvh] max-w-7xl flex-col overflow-hidden">
      <DialogTitle>{request.name} · 문서 미리보기</DialogTitle>
      <DialogDescription>현재 API 명세와 문서 내용을 표시합니다. 창을 닫아도 편집 내용은 유지되며, 저장 전에는 미저장 상태입니다.</DialogDescription>
      <ApiDocumentation request={request} onChange={onChange} />
      {error && <p className="document-validation-error text-sm text-error" role="alert">{error}</p>}
      {downloadError && <p className="document-download-error text-sm text-error" role="alert">{downloadError}</p>}
      <div className="document-dialog-actions flex shrink-0 items-center justify-end gap-2">
        {dirty && <Badge variant="warning">미저장</Badge>}
        <Button className="document-download" variant="outline" disabled={downloading} onClick={download}>
          <Download aria-hidden="true" />{downloading ? '다운로드 중…' : '다운로드'}
        </Button>
        <Button variant="outline" onClick={onClose}>닫기</Button>
        <Button disabled={!dirty} onClick={onSave}>저장</Button>
      </div>
    </DialogContent>
  </Dialog>
}
import { useState } from 'react'
import { Download } from 'lucide-react'
