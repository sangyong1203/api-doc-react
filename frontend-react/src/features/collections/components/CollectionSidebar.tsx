import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HttpMethodBadge } from '@/components/HttpMethodBadge'
import type { SampleRequest, WorkspaceCollection, WorkspaceFolder } from '@/features/workspace/types'
import type { CollectionDeleteTarget, CollectionDialogTarget } from '../types'

type CollectionSidebarProps = {
  collections: WorkspaceCollection[]
  folders: WorkspaceFolder[]
  requests: SampleRequest[]
  selectedId?: string
  onSelect: (request: SampleRequest) => void
  onEdit: (target: CollectionDialogTarget) => void
  onDelete: (target: CollectionDeleteTarget) => void
}

type CollectionActionsProps = {
  name: string
  onEdit: () => void
  onDelete: () => void
  onAddFolder?: () => void
  onAddApi?: () => void
}

function CollectionActions({ name, onEdit, onDelete, onAddFolder, onAddApi }: CollectionActionsProps) {
  const itemClass = 'collection-menu-item flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground'
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button className="collection-actions opacity-0 transition-opacity group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100 text-foreground hover:text-foreground focus-visible:border-transparent focus-visible:ring-0" variant="ghost" size="icon-xs" aria-label={`${name} 메뉴`}><MoreHorizontal aria-hidden="true" /></Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="collection-menu z-50 min-w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md" sideOffset={4} align="end">
          {onAddApi && <DropdownMenu.Item className={itemClass} onSelect={onAddApi}><Plus className="size-3.5" aria-hidden="true" />API 추가</DropdownMenu.Item>}
          {onAddFolder && <DropdownMenu.Item className={itemClass} onSelect={onAddFolder}><Folder className="size-3.5" aria-hidden="true" />폴더 추가</DropdownMenu.Item>}
          <DropdownMenu.Item className={itemClass} onSelect={onEdit}><Pencil className="size-3.5" aria-hidden="true" />수정</DropdownMenu.Item>
          <DropdownMenu.Separator className="collection-menu-divider my-1 h-px bg-border" />
          <DropdownMenu.Item className={`${itemClass} text-error`} onSelect={onDelete}><Trash2 className="size-3.5" aria-hidden="true" />삭제</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function CollectionSidebar({ collections, folders, requests, selectedId, onSelect, onEdit, onDelete }: CollectionSidebarProps) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const term = search.trim().toLowerCase()
  const filtered = requests.filter((request) => `${request.name} ${request.method} ${request.url}`.toLowerCase().includes(term))

  function toggle(id: string) {
    setCollapsed((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function addItem(target: CollectionDialogTarget) {
    setSearch('')
    if (target.kind !== 'collection') {
      const folderId = target.kind === 'api' ? target.folderId : null
      setCollapsed((current) => current.filter((id) => id !== target.collectionId && id !== folderId))
    }
    onEdit(target)
  }

  function renderRequest(request: SampleRequest) {
    return (
      <div className="collection-api-row group/collection-row flex min-w-0 items-center gap-1" key={request.id}>
        <Button className={`collection-request min-w-0 flex-1 text-xs ${selectedId === request.id ? 'bg-primary/20 hover:bg-primary/25' : ''}`}
          variant={selectedId === request.id ? 'secondary' : 'ghost'} aria-current={selectedId === request.id ? 'page' : undefined} onClick={() => onSelect(request)}>
          <HttpMethodBadge method={request.method} /><span className="collection-request-name">{request.name}</span>
        </Button>
        <CollectionActions name={request.name}
          onEdit={() => onEdit({ kind: 'api', collectionId: request.collectionId, folderId: request.folderId, request })}
          onDelete={() => onDelete({ kind: 'api', id: request.id, name: request.name })} />
      </div>
    )
  }

  return (
    <aside className="collection-sidebar" aria-label="컬렉션 탐색">
      <div className="sidebar-heading">
        <span>컬렉션</span>
        <div className="collection-heading-actions flex items-center gap-2">
          <Badge variant="secondary">{requests.length} APIs</Badge>
          <Button className="collection-add" variant="ghost" size="icon-xs" aria-label="컬렉션 추가" onClick={() => addItem({ kind: 'collection' })}><Plus aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="collection-search-field relative">
        <Search className="collection-search-icon pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="collection-search pl-9" aria-label="API 이름, 메서드, 주소 검색" placeholder="API 검색…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <nav className="collection-tree flex flex-col gap-3" aria-label="API 목록">
        {collections.filter((collection) => !term || filtered.some((request) => request.collectionId === collection.id)).map((collection) => {
          const expanded = Boolean(term) || !collapsed.includes(collection.id)
          const collectionRequests = filtered.filter((request) => request.collectionId === collection.id)
          const collectionFolders = folders.filter((folder) => folder.collectionId === collection.id)
          return (
            <section className="collection-group" key={collection.id} aria-label={collection.name}>
              <div className="collection-row group/collection-row flex items-center gap-1">
                <Button className="collection-toggle min-w-0 flex-1 justify-start text-xs aria-expanded:bg-transparent" variant="ghost" aria-expanded={expanded} onClick={() => toggle(collection.id)}>
                  {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<Folder aria-hidden="true" /><span className="truncate">{collection.name}</span>
                </Button>
                <CollectionActions name={collection.name}
                  onAddApi={() => addItem({ kind: 'api', collectionId: collection.id, folderId: null })}
                  onAddFolder={() => addItem({ kind: 'folder', collectionId: collection.id })}
                  onEdit={() => onEdit({ kind: 'collection', collection })}
                  onDelete={() => onDelete({ kind: 'collection', id: collection.id, name: collection.name })} />
              </div>
              {expanded && (
                <div className="collection-children pl-2">
                  {collectionRequests.filter((request) => request.folderId === null).map(renderRequest)}
                  {collectionFolders.filter((folder) => !term || collectionRequests.some((request) => request.folderId === folder.id)).map((folder) => {
                    const folderExpanded = Boolean(term) || !collapsed.includes(folder.id)
                    const folderRequests = collectionRequests.filter((request) => request.folderId === folder.id)
                    return (
                      <div className="collection-folder" key={folder.id}>
                        <div className="collection-folder-row group/collection-row flex items-center gap-1">
                          <Button className="folder-toggle min-w-0 flex-1 text-xs aria-expanded:bg-transparent" variant="ghost" aria-expanded={folderExpanded} onClick={() => toggle(folder.id)}>
                            {folderExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<Folder aria-hidden="true" /><span className="truncate">{folder.name}</span>
                          </Button>
                          <CollectionActions name={folder.name}
                            onAddApi={() => addItem({ kind: 'api', collectionId: collection.id, folderId: folder.id })}
                            onEdit={() => onEdit({ kind: 'folder', collectionId: collection.id, folder })}
                            onDelete={() => onDelete({ kind: 'folder', id: folder.id, name: folder.name })} />
                        </div>
                        {folderExpanded && folderRequests.map(renderRequest)}
                        {folderExpanded && !term && folderRequests.length === 0 && <p className="folder-empty px-4 py-2 text-xs text-muted-foreground">API가 없습니다.</p>}
                      </div>
                    )
                  })}
                  {!term && collectionFolders.length === 0 && collectionRequests.length === 0 && <p className="collection-empty px-4 py-2 text-xs text-muted-foreground">폴더나 API를 추가하세요.</p>}
                </div>
              )}
            </section>
          )
        })}
        {term && filtered.length === 0 && <p className="sidebar-empty text-xs text-muted-foreground" role="status">검색 결과가 없습니다.</p>}
        {collections.length === 0 && <p className="sidebar-empty text-xs text-muted-foreground">컬렉션을 추가해 시작하세요.</p>}
      </nav>
    </aside>
  )
}
