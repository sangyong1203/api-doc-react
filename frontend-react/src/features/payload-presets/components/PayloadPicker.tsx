import { useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2, Check, X, Star } from 'lucide-react'
import { Popover } from 'radix-ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PayloadPreset } from '../types'

type Props = {
  presets: PayloadPreset[]
  selectedId: string | null
  defaultId: string | null
  onSelect: (id: string | null) => void
  onDefault: (id: string | null) => void
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function PayloadPicker({ presets, selectedId, defaultId, onSelect, onDefault, onAdd, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const options = presets

  function rename() {
    const trimmed = name.trim()
    if (!trimmed || presets.some((item) => item.id !== editingId && item.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(!trimmed ? '이름을 입력하세요.' : '같은 이름의 입력 세트가 있습니다.')
      return
    }
    if (editingId) { onRename(editingId, trimmed) }
    setEditingId(null)
    setError('')
  }

  return (
    <Popover.Root open={open} onOpenChange={(value) => { setOpen(value); setEditingId(null); setError('') }}>
      <Popover.Trigger asChild><Button className="payload-picker max-w-44 text-xs" variant="outline" size="sm" aria-label="입력 세트 선택"><span className="truncate">{options.find((item) => item.id === selectedId)?.name ?? '입력 세트 선택'}</span><ChevronDown aria-hidden="true" /></Button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="payload-menu z-50 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border bg-popover p-2 text-popover-foreground shadow-md" align="end" sideOffset={4} aria-label="입력 세트">
          <div className="payload-menu-heading mb-1 border-b px-1 pb-2 pt-1 text-xs font-medium">입력 세트 목록</div>
          <div className="payload-options max-h-64 overflow-x-hidden overflow-y-auto">
            {options.map((item) => <div className={`payload-option flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 ${selectedId === item.id ? 'bg-primary/15 text-foreground' : 'hover:bg-accent/50'}`} key={item.id ?? 'base'}>
              {editingId === item.id && item.id ? <>
                <Input className="payload-name h-6 min-w-0 flex-1 rounded-md px-1.5 py-0 text-xs md:text-xs" aria-label="입력 세트 이름" autoFocus value={name} onChange={(event) => { setName(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { rename() } if (event.key === 'Escape') { event.stopPropagation(); setEditingId(null) } }} />
                <Button size="icon-xs" variant="ghost" aria-label="이름 저장" onClick={rename}><Check /></Button><Button size="icon-xs" variant="ghost" aria-label="이름 편집 취소" onClick={() => { setEditingId(null); setError('') }}><X /></Button>
              </> : <>
                <Button className="payload-select h-6 min-w-0 flex-1 shrink justify-start px-1 text-xs hover:bg-transparent dark:hover:bg-transparent" variant="ghost" size="sm" aria-pressed={selectedId === item.id} onClick={() => { onSelect(item.id); setOpen(false) }}><span className="truncate">{item.name}</span>{defaultId === item.id && <Badge className="payload-default-badge shrink-0 px-1 py-0 text-[10px]" variant="secondary">기본</Badge>}</Button>
                {item.id && <><Button size="icon-xs" variant="ghost" aria-label={`${item.name} 이름 편집`} onClick={() => { setEditingId(item.id); setName(item.name); setError('') }}><Pencil /></Button><Button size="icon-xs" variant="ghost" aria-label={`${item.name} 삭제`} disabled={presets.length === 1} onClick={() => { setOpen(false); onDelete(item.id) }}><Trash2 /></Button></>}
              </>}
              <Button className="payload-default shrink-0" size="icon-xs" variant="ghost" aria-label={`${item.name} 기본 세트 지정`} aria-pressed={defaultId === item.id} title="API를 열 때 기본으로 적용" onClick={() => onDefault(item.id)}><Star className={defaultId === item.id ? 'fill-primary text-primary' : 'text-muted-foreground'} /></Button>
            </div>)}
          </div>
          {error && <p className="payload-name-error py-1 text-xs text-error" role="alert">{error}</p>}
          <div className="payload-menu-footer mt-1 border-t pt-1"><Button className="w-full justify-start" variant="ghost" size="sm" onClick={onAdd}><Plus />입력 세트 추가</Button></div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
