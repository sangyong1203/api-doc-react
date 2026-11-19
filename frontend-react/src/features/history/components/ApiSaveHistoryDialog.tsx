import { useState } from 'react'
import { History, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { HttpMethodBadge } from '@/components/HttpMethodBadge'
import { formatDateTime } from '@/utils/dateTime'
import type { ApiSaveHistory } from '../types'

type Props = {
  apiName: string
  entries: ApiSaveHistory[]
  onRestore: (entry: ApiSaveHistory) => void
  onClose: () => void
}

export function ApiSaveHistoryDialog({ apiName, entries, onRestore, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = entries.find((entry) => entry.id === selectedId)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) { onClose() } }}>
      <DialogContent className="api-save-history-dialog flex max-h-[85dvh] max-w-3xl flex-col overflow-hidden">
        <DialogTitle>{apiName} · 저장 이력</DialogTitle>
        <DialogDescription className="save-history-description text-xs">
          * 저장 이력을 선택하면 당시 명세·문서·입력값을 현재 폼에 되돌릴 수 있습니다. 적용 후 저장 버튼을 눌러야 반영됩니다. 이력은 메모리에 보관하며 새로고침하면 초기화됩니다.
        </DialogDescription>
        <div className="save-history-list min-h-0 overflow-y-auto" role="group" aria-label="API 저장 이력">
          {entries.length === 0 ? (
            <Empty className="save-history-empty min-h-48">
              <EmptyHeader>
                <EmptyMedia variant="icon"><History aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>저장 이력이 없습니다</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="save-history-items flex flex-col gap-2">
              {entries.map((entry) => (
                <Button key={entry.id} className="save-history-entry h-auto w-full justify-start gap-3 px-4 py-3 text-left whitespace-normal"
                  variant={entry.id === selectedId ? 'secondary' : 'outline'} aria-pressed={entry.id === selectedId}
                  onClick={() => setSelectedId(entry.id)}>
                  <div className="save-history-entry-content min-w-0 flex-1 space-y-2">
                    <div className="save-history-entry-heading flex flex-wrap items-center justify-between gap-2">
                      <time className="save-history-date text-sm" dateTime={entry.savedAt}>{formatDateTime(entry.savedAt)}</time>
                      <span className="save-history-preset text-xs text-muted-foreground">{entry.presetName}</span>
                    </div>
                    <div className="save-history-request flex min-w-0 items-start gap-2">
                      <HttpMethodBadge method={entry.request.method} />
                      <span className="save-history-url min-w-0 text-xs break-all">{entry.request.url}</span>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </div>
        <div className="save-history-actions flex shrink-0 justify-end gap-2">
          <Button className="save-history-close" variant="outline" onClick={onClose}>닫기</Button>
          <Button className="save-history-restore" disabled={!selected} onClick={() => { if (selected) { onRestore(selected) } }}>
            <RotateCcw aria-hidden="true" />되돌리기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
