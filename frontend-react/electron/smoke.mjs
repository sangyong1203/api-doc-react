// 로컬 테스트 앱의 디버거 포트만 사용합니다. 앱을 띄운 뒤 README의 검증 절차로 실행합니다.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  assert.equal(targets.length, 1, '테스트할 앱 대상은 한 개여야 합니다.')
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const item = pending.get(message.id)
    if (item) {
      pending.delete(message.id)
      clearTimeout(item.timeout)
      if (message.error) { item.reject(new Error(JSON.stringify(message.error))) } else { item.resolve(message.result) }
    }
  })
  return {
    close: () => socket.close(),
    send(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`디버거 응답 시간 초과: ${method}`)) }, 10000)
        pending.set(id, { resolve, reject, timeout })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    async evaluate(expression) {
      const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) { throw new Error(JSON.stringify(result.exceptionDetails)) }
      return result.result.value
    },
  }
}

const renderer = await connect(Number(process.env.APIDOC_RENDERER_PORT ?? 9333))
const main = await connect(Number(process.env.APIDOC_MAIN_PORT ?? 9334))
let dialogPatched = false
try {
  const versions = await renderer.evaluate('window.apidocDesktop?.versions')
  assert.equal(versions.electron, '45.4.1')
  assert.equal(versions.node, '24.22.3')
  assert.deepEqual(await renderer.evaluate('({url:location.href,node:typeof process,require:typeof require,toolbar:!!document.querySelector(".request-toolbar")})'),
    { url: 'apidoc://app/', node: 'undefined', require: 'undefined', toolbar: true })
  const security = await main.evaluate(`(() => { const w=process.mainModule.require('electron').BrowserWindow.getAllWindows()[0]; const p=w.webContents.getLastWebPreferences(); return {sandbox:p.sandbox,isolated:p.contextIsolation,node:p.nodeIntegration} })()`)
  assert.deepEqual(security, { sandbox: true, isolated: true, node: false })
  assert.equal(await renderer.evaluate(`fetch('/missing.js').then(r=>r.status)`), 404)
  assert.equal(await renderer.evaluate(`fetch('/').then(r=>r.headers.get('content-security-policy')).then(v=>v.includes("object-src 'none'"))`), true)
  assert.equal(await renderer.evaluate(`(async()=>{const before=location.href;window.open('https://example.com');return before===location.href})()`), true)
  assert.equal(await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length`), 1)

  if (process.env.APIDOC_CAPTURE_SCREENSHOT === '1') {
    const screenshot = await renderer.send('Page.captureScreenshot', { format: 'png' })
    await writeFile('out/desktop-smoke.png', Buffer.from(screenshot.data, 'base64'))
  }

  // 실제 종료 IPC와 dialog 분기를 통과하되, 테스트가 사용자 확인창에서 멈추지 않도록 응답만 대체합니다.
  await main.evaluate(`globalThis.desktopSmoke={dialogs:[],response:0,original:process.mainModule.require('electron').dialog.showMessageBox}; process.mainModule.require('electron').dialog.showMessageBox=async(...args)=>{desktopSmoke.dialogs.push(args.at(-1));return {response:desktopSmoke.response,checkboxChecked:false}}; true`)
  dialogPatched = true
  const click = async (selector) => {
    const point = await renderer.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    assert.ok(point, `요소 누락: ${selector}`)
    await renderer.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await renderer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await delay(100)
  }
  const input = async (selector, value) => {
    assert.equal(await renderer.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`), true)
    await delay(100)
  }
  const closeAndCancel = async () => {
    const count = await main.evaluate('desktopSmoke.dialogs.length')
    await main.evaluate(`setImmediate(()=>process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].close());true`)
    for (let i = 0; i < 50; i++) {
      if (await main.evaluate('desktopSmoke.dialogs.length') > count) { break }
      await delay(100)
    }
    assert.equal(await main.evaluate('desktopSmoke.dialogs.length'), count + 1)
    assert.equal(await main.evaluate('desktopSmoke.dialogs.at(-1).defaultId'), 0)
    assert.equal(await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length`), 1)
  }
  await click('.request-send')
  await closeAndCancel()
  assert.match(await main.evaluate('desktopSmoke.dialogs.at(-1).detail'), /실행/)
  await delay(1400)

  await click('.environment-trigger')
  await click('.environment-settings-action')
  const originalEnvironmentName = await renderer.evaluate('document.querySelector(".environment-name-input").value')
  await input('.environment-name-input', 'Desktop smoke environment')
  await closeAndCancel()
  assert.equal(await renderer.evaluate('document.querySelector(".environment-name-input").value'), 'Desktop smoke environment')
  await input('.environment-name-input', originalEnvironmentName)
  await click('.environment-settings-footer button:first-of-type')

  await click('.collection-add')
  await input('.entity-name-input', 'Desktop smoke collection')
  await closeAndCancel()
  assert.equal(await renderer.evaluate('document.querySelector(".entity-name-input").value'), 'Desktop smoke collection')
  await click('.collection-dialog-actions button:first-child')

  await input('.url-input', '{{baseUrl}}/desktop-smoke')
  await closeAndCancel()
  assert.equal(await renderer.evaluate('document.querySelector(".url-input").value'), '{{baseUrl}}/desktop-smoke')

  await click('.workspace-name')
  // 메뉴 선택 후 생성 폼은 실제 UI 경로로 진행합니다.
  await click('.workspace-create-action')
  await input('.workspace-name-input', 'Desktop smoke workspace')
  await click('.workspace-create-submit')
  assert.equal(await renderer.evaluate('document.querySelector(".workspace-session:not([hidden]) .request-toolbar")===null'), true)
  await closeAndCancel()
  assert.match(await main.evaluate('desktopSmoke.dialogs.at(-1).detail'), /미저장/)

  const second = spawn(path.resolve('out/APIDOC-win32-x64/APIDOC.exe'), [], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } })
  await new Promise((resolve, reject) => { second.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`중복 실행 종료 코드 ${code}`))); second.once('error', reject) })
  assert.equal(await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length`), 1)

  // 최종 종료는 취소 분기와 동일한 실제 IPC를 사용하며 확인 응답만 1로 바꿉니다.
  await main.evaluate(`desktopSmoke.response=1;setImmediate(()=>process.mainModule.require('electron').app.quit());true`)
  await delay(500)
  console.log('Desktop smoke passed: packaged UI, runtime isolation, CSP, missing asset, new-window denial, running request, environment/collection drafts, unsaved cancel, hidden workspace, single instance, confirmed quit.')
} finally {
  if (dialogPatched) {
    try { await main.evaluate(`process.mainModule.require('electron').dialog.showMessageBox=desktopSmoke.original;true`) } catch { /* 종료된 앱에는 복구할 핸들이 없습니다. */ }
  }
  renderer.close()
  main.close()
}
