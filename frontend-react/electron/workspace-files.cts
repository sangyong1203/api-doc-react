import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Stats } from 'node:fs'
import type { ContentHash, WorkspaceSnapshot } from '../src/types/desktopData.js'
import { validateWorkspaceBundle, WORKSPACE_LIMITS, WORKSPACE_UUID, WorkspaceError } from './workspace-format.cjs'

export type WorkspaceRoot = { canonicalPath: string; device: number; inode: number }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const hash = (value: Uint8Array | string): ContentHash => `sha256:${createHash('sha256').update(value).digest('hex')}`
function same(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino && a.isDirectory() === b.isDirectory() && a.isFile() === b.isFile() }
export async function selectWorkspaceRoot(selectedPath: string): Promise<WorkspaceRoot> {
  try {
    if (!path.isAbsolute(selectedPath)) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    const canonicalPath = await realpath(selectedPath)
    const stat = await lstat(canonicalPath)
    if (!stat.isDirectory() || stat.isSymbolicLink()) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    return { canonicalPath, device: stat.dev, inode: stat.ino }
  } catch (error) {
    if (error instanceof WorkspaceError) { throw error }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { throw new WorkspaceError('WORKSPACE_NOT_FOUND') }
    throw new WorkspaceError('FILE_READ_FAILED')
  }
}
/** 루트 교체와 관리 트리의 링크를 반복 검사합니다. Windows reparse/경합의 실제 검증은 별도로 필요합니다. */
async function rootCheck(root: WorkspaceRoot): Promise<void> {
  const stat = await lstat(root.canonicalPath)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== root.device || stat.ino !== root.inode || await realpath(root.canonicalPath) !== root.canonicalPath) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
}
async function directoryCheck(root: WorkspaceRoot, directory: string, expected?: Stats): Promise<Stats> {
  await rootCheck(root)
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (expected && !same(stat, expected)) || await realpath(directory) !== directory) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
  return stat
}
async function readManagedFile(root: WorkspaceRoot, relative: string, parent: Stats): Promise<Buffer> {
  const file = path.join(root.canonicalPath, relative)
  const directory = path.dirname(file)
  await directoryCheck(root, directory, parent)
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
  if (before.size > WORKSPACE_LIMITS.fileBytes) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!same(before, opened) || !opened.isFile() || await realpath(file) !== file) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
    // 증가 중인 파일도 상한+1바이트에서 읽기를 멈추며 stat만 믿고 무제한 읽지 않습니다.
    const chunks: Buffer[] = []
    let bytes = 0
    while (bytes <= WORKSPACE_LIMITS.fileBytes) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, WORKSPACE_LIMITS.fileBytes + 1 - bytes))
      const read = await handle.read(buffer, 0, buffer.length, null)
      if (read.bytesRead === 0) { break }
      bytes += read.bytesRead; chunks.push(buffer.subarray(0, read.bytesRead))
    }
    if (bytes > WORKSPACE_LIMITS.fileBytes) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
    const after = await handle.stat()
    const final = await lstat(file)
    await directoryCheck(root, directory, parent)
    if (!same(opened, after) || !same(after, final) || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) { throw new WorkspaceError('FILE_CONFLICT') }
    return Buffer.concat(chunks)
  } finally { await handle.close() }
}
async function collect(root: WorkspaceRoot): Promise<{ files: Record<string, string>; hashes: Record<string, ContentHash> }> {
  const rootStat = await directoryCheck(root, root.canonicalPath)
  const entries: Array<{ relative: string; parent: Stats }> = [{ relative: 'workspace.json', parent: rootStat }]
  for (const kind of ['apis', 'environments']) {
    const directory = path.join(root.canonicalPath, kind)
    let stat: Stats
    try { stat = await directoryCheck(root, directory) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { continue }
      throw error
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const id = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : ''
      if (entry.isSymbolicLink()) { throw new WorkspaceError('PATH_NOT_ALLOWED') }
      if (!entry.isFile() || !WORKSPACE_UUID.test(id)) { throw new WorkspaceError('DOCUMENT_INVALID') }
      entries.push({ relative: `${kind}/${entry.name}`, parent: stat })
      if (entries.length > WORKSPACE_LIMITS.files) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
    }
    await directoryCheck(root, directory, stat)
  }
  const files: Record<string, string> = {}, hashes: Record<string, ContentHash> = {}
  let total = 0
  for (const entry of entries.sort((a, b) => compare(a.relative, b.relative))) {
    const bytes = await readManagedFile(root, entry.relative, entry.parent)
    total += bytes.length
    if (total > WORKSPACE_LIMITS.totalBytes) { throw new WorkspaceError('PAYLOAD_TOO_LARGE') }
    try { files[entry.relative] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw new WorkspaceError('DOCUMENT_INVALID') }
    hashes[entry.relative] = hash(bytes)
  }
  return { files, hashes }
}
/** 실제 바이트·파일 목록을 두 번 수집해 관측한 경합은 성공으로 반환하지 않습니다. 파일은 수정하지 않습니다. */
export async function readWorkspaceSnapshot(root: WorkspaceRoot): Promise<WorkspaceSnapshot> {
  try {
    const first = await collect(root)
    const second = await collect(root)
    if (JSON.stringify(first.hashes) !== JSON.stringify(second.hashes)) { throw new WorkspaceError('FILE_CONFLICT') }
    const identity = validateWorkspaceBundle(second.files)
    const documents = Object.entries(second.files).map(([relative, json]) => {
      const data = { id: relative === 'workspace.json' ? identity.id : path.posix.basename(relative, '.json'), json, hash: second.hashes[relative] }
      if (relative === 'workspace.json') { return { ...data, kind: 'workspace' as const } }
      if (relative.startsWith('apis/')) { return { ...data, kind: 'api' as const } }
      return { ...data, kind: 'environment' as const }
    })
    return { revision: hash(JSON.stringify(Object.entries(second.hashes))), workspace: documents.find(doc => doc.kind === 'workspace')!, apis: documents.filter(doc => doc.kind === 'api'), environments: documents.filter(doc => doc.kind === 'environment') }
  } catch (error) {
    if (error instanceof WorkspaceError) { throw error }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { throw new WorkspaceError('FILE_CONFLICT') }
    throw new WorkspaceError('FILE_READ_FAILED')
  }
}
/** 새 manifest는 완성한 임시 파일에서 배타적으로 공개합니다. 기존 manifest·관리 폴더는 덮어쓰지 않습니다. */
export async function createWorkspaceFiles(root: WorkspaceRoot, name: string): Promise<WorkspaceSnapshot> {
  const directories: Array<{ path: string; stat: Stats }> = []
  const temporary = path.join(root.canonicalPath, `.apidoc-create-${randomUUID()}.tmp`)
  let published = false
  try {
    await rootCheck(root)
    for (const name of ['workspace.json', 'apis', 'environments']) {
      try { await lstat(path.join(root.canonicalPath, name)); throw new WorkspaceError('WORKSPACE_ALREADY_EXISTS') } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error }
      }
    }
    for (const name of ['apis', 'environments']) {
      await rootCheck(root)
      const directory = path.join(root.canonicalPath, name)
      await mkdir(directory)
      directories.push({ path: directory, stat: await directoryCheck(root, directory) })
    }
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ formatVersion: 1, id: randomUUID(), name, collections: [], environmentIds: [] }, null, 2) + '\n'); await handle.sync() } finally { await handle.close() }
    await rootCheck(root)
    for (const directory of directories) { await directoryCheck(root, directory.path, directory.stat) }
    await link(temporary, path.join(root.canonicalPath, 'workspace.json'))
    published = true
    await unlink(temporary)
    return await readWorkspaceSnapshot(root)
  } catch (error) {
    if (!published) {
      try { await unlink(temporary) } catch { /* 자신의 임시 파일 외에는 삭제하지 않습니다. */ }
      for (const directory of directories.reverse()) {
        try { await directoryCheck(root, directory.path, directory.stat); await rmdir(directory.path) } catch { /* 변경됐거나 비어 있지 않은 폴더는 보호합니다. */ }
      }
    }
    if (error instanceof WorkspaceError) { throw error }
    throw new WorkspaceError('FILE_WRITE_FAILED')
  }
}
