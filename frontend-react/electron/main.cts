import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AppCloseState } from '../src/types/desktop.js'

const APP_ORIGIN = 'apidoc://app'
protocol.registerSchemesAsPrivileged([{ scheme: 'apidoc', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.setName('APIDOC')

// 테스트/개발 프로필은 배포 앱의 개인 데이터와 분리합니다. 배포본에서는 외부 경로 설정을 받지 않습니다.
if (!app.isPackaged) {
  app.setPath('userData', process.env.APIDOC_DEV_USER_DATA ?? path.join(app.getPath('appData'), 'APIDOC Development'))
}

let mainWindow: BrowserWindow | null = null
let exitApproved = false
let pendingClose: { id: string; resolve: (state: AppCloseState | null) => void } | null = null
let closeInProgress = false

function getDevUrl(): string | null {
  if (app.isPackaged) { return null }
  const argument = process.argv.find((value) => value.startsWith('--dev-url='))
  if (!argument) { return null }
  const url = new URL(argument.slice('--dev-url='.length))
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('개발 화면은 127.0.0.1의 HTTP 루트 주소만 허용합니다.')
  }
  return url.href
}

const devUrl = getDevUrl()

function isAppUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return devUrl ? url.origin === new URL(devUrl).origin : url.protocol === 'apidoc:' && url.hostname === 'app' && !url.port && !url.username && !url.password
  } catch { return false }
}

function registerAppProtocol() {
  const rendererRoot = path.join(app.getAppPath(), 'dist')
  protocol.handle('apidoc', async (request) => {
    const url = new URL(request.url)
    if (!isAppUrl(request.url) || request.method !== 'GET') { return new Response(null, { status: 403 }) }
    let pathname: string
    try { pathname = decodeURIComponent(url.pathname) } catch { return new Response(null, { status: 400 }) }
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) {
      return new Response(null, { status: 403 })
    }
    const requestedFile = path.resolve(rendererRoot, `.${pathname}`)
    if (requestedFile !== rendererRoot && !requestedFile.startsWith(`${rendererRoot}${path.sep}`)) {
      return new Response(null, { status: 403 })
    }
    // SPA 경로는 index.html로 연결하고 누락된 정적 자원은 404로 구분합니다.
    const target = pathname === '/' || (!path.extname(pathname) && request.headers.get('accept')?.includes('text/html'))
      ? path.join(rendererRoot, 'index.html') : requestedFile
    if (!existsSync(target)) { return new Response(null, { status: 404 }) }
    const response = await net.fetch(pathToFileURL(target).href)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'")
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, { status: response.status, headers })
  })
}

// 무응답 화면을 정상/저장 완료로 취급하지 않습니다. 사용자에게 별도 종료 확인을 제공합니다.
function queryCloseState(window: BrowserWindow): Promise<AppCloseState | null> {
  return new Promise((resolve) => {
    const id = randomUUID()
    const timeout = setTimeout(() => finish(null), 5000)
    const finish = (state: AppCloseState | null) => {
      clearTimeout(timeout)
      pendingClose = null
      resolve(state)
    }
    pendingClose = { id, resolve: finish }
    if (window.webContents.isDestroyed()) { finish(null); return }
    window.webContents.send('app:close-request', id)
  })
}

async function requestClose() {
  const window = mainWindow
  if (!window || window.isDestroyed() || closeInProgress) { return }
  closeInProgress = true
  try {
    const state = await queryCloseState(window)
    if (window.isDestroyed()) { return }
    if (!state || state.dirty || state.running) {
      const detail = !state ? '화면의 종료 상태를 확인할 수 없습니다. 저장하지 않은 내용이 사라질 수 있습니다.'
        : [state.dirty ? '미저장 변경이 사라집니다.' : '', state.running ? '실행 중인 요청을 중단합니다.' : ''].filter(Boolean).join(' ')
      const result = await dialog.showMessageBox(window, {
        type: 'warning', title: 'APIDOC 종료', message: '앱을 종료하시겠습니까?', detail,
        buttons: ['취소', '종료'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (result.response !== 1) { return }
    }
    exitApproved = true
    window.destroy()
    app.quit()
  } finally { closeInProgress = false }
}

function createWindow() {
  const window = new BrowserWindow({
    title: 'APIDOC', width: 1500, height: 960, minWidth: 900, minHeight: 640, show: false, backgroundColor: '#171d1c',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false },
  })
  mainWindow = window
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) { event.preventDefault() } })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.on('close', (event) => { if (!exitApproved) { event.preventDefault(); void requestClose() } })
  window.on('closed', () => { mainWindow = null })
  window.once('ready-to-show', () => window.show())
  const load = devUrl ? window.loadURL(devUrl) : window.loadURL(`${APP_ORIGIN}/`)
  void load.catch((error: unknown) => {
    dialog.showErrorBox('APIDOC 실행 오류', error instanceof Error ? error.message : '화면을 불러오지 못했습니다.')
    exitApproved = true
    app.quit()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) { mainWindow.restore() }
      mainWindow.show()
      mainWindow.focus()
    }
  })
  app.on('before-quit', (event) => { if (!exitApproved && mainWindow) { event.preventDefault(); void requestClose() } })
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(() => {
    registerAppProtocol()
    ipcMain.on('app:close-state', (event, requestId: unknown, state: unknown) => {
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame
        || !isAppUrl(event.senderFrame.url) || requestId !== pendingClose?.id || !state || typeof state !== 'object') { return }
      const value = state as Record<string, unknown>
      if (typeof value.dirty !== 'boolean' || typeof value.running !== 'boolean' || Object.keys(value).some((key) => key !== 'dirty' && key !== 'running')) { return }
      pendingClose?.resolve({ dirty: value.dirty, running: value.running })
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '파일', submenu: [{ label: '종료', accelerator: 'Alt+F4', click: () => app.quit() }] },
      { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '보기', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : [])] },
    ]))
    createWindow()
  })
}
