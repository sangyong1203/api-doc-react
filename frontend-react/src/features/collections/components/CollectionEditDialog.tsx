import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { HttpMethod, WorkspaceCollection, WorkspaceFolder } from '@/features/workspace/types'
import type { CollectionDialogTarget, CollectionFormValues } from '../types'

type CollectionEditDialogProps = {
  target: CollectionDialogTarget
  collections: WorkspaceCollection[]
  folders: WorkspaceFolder[]
  onClose: () => void
  // 중복 이름 등 저장할 수 없는 경우 사용자에게 표시할 오류 문구를 반환합니다.
  onSubmit: (values: CollectionFormValues) => string | null
}

export function CollectionEditDialog({ target, collections, folders, onClose, onSubmit }: CollectionEditDialogProps) {
  const entity = target.kind === 'collection' ? target.collection : target.kind === 'folder' ? target.folder : target.request
  const [name, setName] = useState(entity?.name ?? '')
  const [collectionId, setCollectionId] = useState(target.kind === 'collection' ? '' : target.collectionId)
  const [folderId, setFolderId] = useState<string | null>(target.kind === 'api' ? target.folderId : null)
  const [method, setMethod] = useState<HttpMethod>(target.kind === 'api' ? target.request?.method ?? 'GET' : 'GET')
  const [url, setUrl] = useState(target.kind === 'api' ? target.request?.url ?? '' : '')
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const kindLabel = target.kind === 'collection' ? '컬렉션' : target.kind === 'folder' ? '폴더' : 'API'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) { onClose() } }}>
      <DialogContent className="collection-edit-dialog" aria-describedby={undefined}>
        <DialogTitle>{kindLabel} {entity ? '수정' : '추가'}</DialogTitle>
        <form className="collection-edit-form grid gap-4" onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) { setError('이름을 입력하세요.'); return }
          if (target.kind === 'api' && !url.trim()) { setError('요청 URL을 입력하세요.'); return }
          const message = onSubmit({ name: name.trim(), collectionId, folderId, method, url: url.trim() })
          setError(message)
          if (!message) { onClose() }
        }}>
          <label className="entity-name-field grid gap-1.5 text-sm">
            이름
            <Input className="entity-name-input" autoFocus value={name} maxLength={100} aria-describedby={error ? errorId : undefined} onChange={(event) => { setName(event.target.value); setError(null) }} />
          </label>
          {target.kind === 'api' && (
            <>
              <div className="api-location-fields grid grid-cols-2 gap-3">
                <label className="api-collection-field grid gap-1.5 text-sm">컬렉션
                  <Select value={collectionId} onValueChange={(value) => { setCollectionId(value); setFolderId(null) }}>
                    <SelectTrigger className="w-full" aria-label="API 컬렉션"><SelectValue /></SelectTrigger>
                    <SelectContent>{collections.map((collection) => <SelectItem key={collection.id} value={collection.id}>{collection.name}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <label className="api-folder-field grid gap-1.5 text-sm">폴더
                  <Select value={folderId ?? 'root'} onValueChange={(value) => setFolderId(value === 'root' ? null : value)}>
                    <SelectTrigger className="w-full" aria-label="API 폴더"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="root">컬렉션 바로 아래</SelectItem>
                      {folders.filter((folder) => folder.collectionId === collectionId).map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <label className="api-method-field grid gap-1.5 text-sm">메서드
                <Select value={method} onValueChange={(value) => setMethod(value as HttpMethod)}>
                  <SelectTrigger aria-label="API 메서드"><SelectValue /></SelectTrigger>
                  <SelectContent>{(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="api-url-field grid gap-1.5 text-sm">요청 URL
                <Input className="api-url-input" placeholder="{{baseUrl}}/path" value={url} onChange={(event) => { setUrl(event.target.value); setError(null) }} />
              </label>
            </>
          )}
          {error && <p className="collection-form-error text-sm text-error" role="alert" id={errorId}>{error}</p>}
          <div className="collection-dialog-actions flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button type="submit">{entity ? '변경 적용' : '추가'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
