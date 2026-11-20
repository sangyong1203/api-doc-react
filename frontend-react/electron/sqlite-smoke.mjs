import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'

const mode = process.argv[2] ?? 'development'
assert.ok(mode === 'development' || mode === 'packaged', '검증 모드는 development 또는 packaged입니다.')
const root = await mkdtemp(path.join(os.tmpdir(), 'apidoc-sqlite-proof-'))
const profile = path.join(root, 'profile')
const directory = path.join(profile, 'sqlite-compatibility')
const token = randomUUID()
await mkdir(directory, { recursive: true })
await writeFile(path.join(directory, 'probe.json'), JSON.stringify({ purpose: 'apidoc-sqlite-compatibility', token }), { flag: 'wx' })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const executable = mode === 'development' ? electron : path.resolve(process.env.APIDOC_TEST_EXECUTABLE ?? 'out/APIDOC-win32-x64/APIDOC.exe')

// 개발·패키징 모두 서로 다른 앱 프로세스를 두 번 실행해 같은 임시 DB를 재조회합니다.
async function runStage(stage) {
  const args = mode === 'development'
    ? [path.resolve('dist-electron/electron/sqlite-probe-main.cjs'), profile, stage, token]
    : [`--user-data-dir=${profile}`, '--inspect=127.0.0.1:0']
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  let errors = ''
  let socket
  let evaluate
  let rejectResult
  let readinessTimer
  let debuggerStarted = false
  const result = new Promise((resolve, reject) => {
    evaluate = resolve
    rejectResult = reject
    child.once('error', reject)
  })
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`SQLite ${stage} 앱 종료 코드 ${code}: ${errors}`)))
  })
  const terminate = () => {
    if (child.exitCode !== null || !child.pid) { return }
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else { child.kill() }
  }
  const timeout = setTimeout(() => { rejectResult(new Error(`SQLite ${stage} 검증 시간 초과: ${errors}`)); terminate(); socket?.close() }, 25000)
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
    const match = output.match(/APIDOC_SQLITE_RESULT:([^\r\n]+)\r?\n/)
    if (match) { evaluate(JSON.parse(match[1])) }
  })
  child.stderr.on('data', (chunk) => {
    errors += chunk.toString()
    const address = errors.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1]
    if (mode !== 'packaged' || !address || debuggerStarted) { return }
    debuggerStarted = true
    socket = new WebSocket(address)
    const sendProbe = () => {
      // Worker와 DB는 실제 app.asar 안의 모듈로 실행하며 일반 앱에 테스트 IPC를 추가하지 않습니다.
      const expression = `(async()=>{const {app,BrowserWindow}=process.mainModule.require('electron');await app.whenReady();const window=BrowserWindow.getAllWindows()[0];if(window.webContents.isLoading())await new Promise(resolve=>window.webContents.once('did-finish-load',resolve));const path=process.mainModule.require('node:path');if(path.resolve(app.getPath('userData'))!==${JSON.stringify(profile)})throw Error('Unexpected test profile');const probe=process.mainModule.require(path.join(app.getAppPath(),'dist-electron/electron/sqlite-probe.cjs'));return probe.runSqliteProbe(${JSON.stringify({ directory, token, stage })});})()`
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    }
    const checkReady = () => socket.send(JSON.stringify({ id: 100, method: 'Runtime.evaluate', params: {
      expression: "Boolean(process.mainModule && process.mainModule.require('electron').app?.isReady())", returnByValue: true,
    } }))
    socket.addEventListener('open', checkReady)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === 2) { socket.close(); return }
      if (message.id === 100) {
        if (message.result?.result?.value === true) { sendProbe() } else { readinessTimer = setTimeout(checkReady, 100) }
        return
      }
      if (message.id !== 1) { return }
      if (message.error || message.result.exceptionDetails) {
        errors += JSON.stringify(message)
        terminate()
        socket.close()
        return
      }
      evaluate(message.result.result.value)
      console.log(`SQLite packaged ${stage}: Worker completed`)
      socket.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: "process.mainModule.require('electron').BrowserWindow.getAllWindows().forEach(window=>window.destroy());process.mainModule.require('electron').app.quit();true" } }))
    })
    socket.addEventListener('error', () => { rejectResult(new Error('SQLite 검증용 디버거 연결 실패')); terminate() })
  })
  try {
    const [value] = await Promise.all([result, exit])
    assert.equal(value.stage, stage)
    assert.equal(value.electron, '45.4.1')
    assert.equal(value.node, '24.22.3')
    assert.ok(value.threadId > 0)
    assert.equal(value.rows, 2)
    assert.equal(value.rollbackVerified, true)
    assert.equal(value.integrityVerified, true)
    if (stage === 'verify') { assert.equal(value.readOnlyVerified, true) }
    console.log(JSON.stringify({ mode, ...value }))
  } finally { clearTimeout(timeout); clearTimeout(readinessTimer); socket?.close(); terminate() }
}

await runStage('write')
await runStage('verify')
console.log(`SQLite ${mode} compatibility passed; retained temporary fixture: ${root}`)
