import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { ContentHash, DocumentKind } from '../src/types/desktopData.js'
import type { WorkspaceRoot } from './workspace-files.cjs'
import { directoryCheck, readManagedFile, rootCheck } from './workspace-files.cjs'
import { isWorkspaceTemporary, WORKSPACE_LIMITS, WORKSPACE_UUID, WorkspaceError } from './workspace-format.cjs'

export const contentHash = (value: string | Uint8Array): ContentHash => `sha256:${createHash('sha256').update(value).digest('hex')}`
/** JSON 객체 키만 정렬합니다. 배열 순서와 문자열·0·false·null은 그대로 보존합니다. */
export function stableJson(value: unknown): string {
  const sorted = (_key: string, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]])) : item
  return JSON.stringify(value, sorted, 2) + '\n'
}
type OrderRule = { keys: string[]; children?: Record<string, string> }
// storage-v1.schema.json의 속성 순서. UUID 맵만 이름순으로 정렬하고 배열 순서는 보존합니다.
const rules: Record<string, OrderRule> = {
  workspace: { keys: ['formatVersion', 'id', 'name', 'collections', 'environmentIds'], children: { collections: 'collection' } },
  collection: { keys: ['id', 'name', 'apiIds', 'folders'], children: { folders: 'folder' } },
  folder: { keys: ['id', 'name', 'apiIds'] },
  api: { keys: ['formatVersion', 'id', 'name', 'method', 'url', 'request', 'response', 'documentation', 'defaultPresetId', 'presets'], children: { request: 'request', response: 'response', documentation: 'documentation', presets: 'preset' } },
  request: { keys: ['path', 'query', 'headers', 'body'], children: { path: 'field', query: 'field', headers: 'field', body: 'body' } },
  field: { keys: ['id', 'name', 'type', 'required', 'description', 'arrayFormat', 'parentId'] },
  body: { keys: ['format', 'json', 'multipart'], children: { json: 'field', multipart: 'field' } },
  response: { keys: ['success', 'errors'], children: { success: 'field', errors: 'error' } },
  error: { keys: ['id', 'name', 'status', 'description', 'fields'], children: { fields: 'variable' } },
  documentation: { keys: ['description', 'requestExample', 'responseExample'] },
  preset: { keys: ['id', 'name', 'description', 'values'], children: { values: 'values' } },
  values: { keys: ['path', 'query', 'headers', 'body', 'multipart'], children: { path: 'cellMap', query: 'cellMap', headers: 'cellMap', body: 'bodyValues', multipart: 'cellMap' } },
  bodyValues: { keys: ['fields', 'enabled'], children: { fields: 'cellMap', enabled: 'map' } },
  cell: { keys: ['enabled', 'value', 'secretRef'] },
  environment: { keys: ['formatVersion', 'id', 'name', 'variables'], children: { variables: 'variable' } },
  variable: { keys: ['id', 'name', 'enabled', 'value', 'secretRef'] },
}
/** 스키마 속성 순서·2칸 들여쓰기·LF. 알 수 없는 속성도 보존하여 후속 검증에서 거부합니다. */
export function serializeWorkspaceDocument(kind: DocumentKind, value: unknown): string {
  const arrange = (item: unknown, context: string): unknown => {
    if (Array.isArray(item)) { return item.map(child => arrange(child, context)) }
    if (item === null || typeof item !== 'object') { return item }
    const data = item as Record<string, unknown>, rule = rules[context]
    const keys = rule ? [...rule.keys.filter(key => Object.hasOwn(data, key)), ...Object.keys(data).filter(key => !rule.keys.includes(key)).sort()] : Object.keys(data).sort()
    return Object.fromEntries(keys.map(key => [key, arrange(data[key], context === 'cellMap' ? 'cell' : rule?.children?.[key] ?? 'map')]))
  }
  return JSON.stringify(arrange(value, kind), null, 2) + '\n'
}
function checkRelative(relative: string): void {
  if (relative === 'workspace.json') { return }
  const match = /^(apis|environments)\/([^/]+)\.json$/.exec(relative)
  if (!match || !WORKSPACE_UUID.test(match[2])) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
}
/** Windows는 디렉터리 fsync를 지원하지 않아 파일 sync 후 교체까지만 수행합니다. */
export async function syncWriteDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') { return }
  const handle = await open(directory, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try { await handle.sync() } finally { await handle.close() }
}
async function currentHash(root: WorkspaceRoot, relative: string): Promise<ContentHash | null> {
  const directory = path.dirname(path.join(root.canonicalPath, relative))
  const parent = await directoryCheck(root, directory)
  try { return contentHash(await readManagedFile(root, relative, parent)) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return null }
    throw error
  }
}
function checkTemporary(tempName: string): void {
  if (!isWorkspaceTemporary(tempName)) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
}
/** tempName은 내부 작업 UUID로만 구성합니다. allowedJson은 원본/후보이며 null은 파일 부재입니다. */
export async function cleanupWriteTemporary(root: WorkspaceRoot, tempName: string, relative: string, allowedJson: Array<string | null>): Promise<void> {
  checkRelative(relative)
  checkTemporary(tempName)
  await rootCheck(root)
  const directory = path.dirname(path.join(root.canonicalPath, relative))
  let parent
  try { parent = await directoryCheck(root, directory) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return }
    throw error
  }
  const temporary = path.join(directory, tempName)
  let stat
  try { stat = await lstat(temporary) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return }
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 2) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
  // 신규 파일 공개(link) 직후 중단되면 temp와 목적 파일의 두 링크가 남습니다.
  // 두 경로가 같은 파일이고 내용이 저널의 후보와 같을 때만 자신의 링크를 정리합니다.
  const handle = await open(temporary, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > WORKSPACE_LIMITS.fileBytes) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    const buffer = Buffer.alloc(opened.size + 1)
    let size = 0
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, null)
      if (!read.bytesRead) { break }
      size += read.bytesRead
    }
    const bytes = buffer.subarray(0, size)
    const candidates = allowedJson.filter((json): json is string => json !== null).map(json => Buffer.from(json))
    const unchanged = await handle.stat()
    if (size !== opened.size || unchanged.size !== opened.size || unchanged.mtimeMs !== opened.mtimeMs || unchanged.ctimeMs !== opened.ctimeMs) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    // 쓰다 중단된 자신의 후보는 알려진 원본/후보의 접두 바이트일 때만 정리합니다.
    if (!candidates.some(candidate => candidate.length >= bytes.length && candidate.subarray(0, bytes.length).equals(bytes))) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    if (stat.nlink === 2) {
      const target = path.join(root.canonicalPath, relative)
      await directoryCheck(root, path.dirname(target))
      const destination = await lstat(target)
      if (destination.dev !== stat.dev || destination.ino !== stat.ino || !candidates.some(candidate => candidate.equals(bytes))) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    }
    await directoryCheck(root, directory, parent)
    const final = await lstat(temporary)
    if (final.dev !== stat.dev || final.ino !== stat.ino) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    await unlink(temporary)
    await syncWriteDirectory(directory)
  } finally { await handle.close() }
}
/** 검증된 한 문서만 교체합니다. expected=null은 부재, json=null은 삭제를 뜻합니다. */
export async function replaceWorkspaceFile(root: WorkspaceRoot, relative: string, expected: ContentHash | null, json: string | null, tempName: string): Promise<void> {
  checkRelative(relative)
  checkTemporary(tempName)
  const target = path.join(root.canonicalPath, relative)
  const directory = path.dirname(target)
  await rootCheck(root)
  try { await directoryCheck(root, directory) } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || expected !== null || json === null) { throw error }
    await mkdir(directory, { mode: 0o700 })
    await directoryCheck(root, directory)
    await syncWriteDirectory(root.canonicalPath)
  }
  const parent = await directoryCheck(root, directory)
  if (await currentHash(root, relative) !== expected) { throw new WorkspaceError('FILE_CONFLICT') }
  if (json === null) {
    if (expected === null) { return }
    await directoryCheck(root, directory, parent)
    await unlink(target)
    await syncWriteDirectory(directory)
    return
  }
  const temporary = path.join(directory, tempName)
  const handle = await open(temporary, 'wx', 0o600)
  let written
  try { await handle.writeFile(json); await handle.sync(); written = await handle.stat() } finally { await handle.close() }
  const staged = await lstat(temporary)
  if (staged.dev !== written.dev || staged.ino !== written.ino || contentHash(await readManagedFile(root, path.relative(root.canonicalPath, temporary), parent)) !== contentHash(json)) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
  // 임시 파일 쓰기 중 다른 도구가 원본을 바꿨다면 교체하지 않습니다.
  await directoryCheck(root, directory, parent)
  if (await currentHash(root, relative) !== expected) { throw new WorkspaceError('FILE_CONFLICT') }
  if (expected === null) { await link(temporary, target); await unlink(temporary) }
  else { await rename(temporary, target) }
  await syncWriteDirectory(directory)
  if (directory !== root.canonicalPath) { await syncWriteDirectory(root.canonicalPath) }
}
