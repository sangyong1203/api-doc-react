import type { HttpMethod, SampleRequest, WorkspaceCollection, WorkspaceFolder } from '@/features/workspace/types'

export type CollectionDialogTarget =
  | { kind: 'collection'; collection?: WorkspaceCollection }
  | { kind: 'folder'; collectionId: string; folder?: WorkspaceFolder }
  | { kind: 'api'; collectionId: string; folderId: string | null; request?: SampleRequest }

export type CollectionFormValues = {
  name: string
  collectionId: string
  folderId: string | null
  method: HttpMethod
  url: string
}

export type CollectionDeleteTarget = { kind: 'collection' | 'folder' | 'api'; id: string; name: string }
