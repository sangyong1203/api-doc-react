// 로컬 테스트 앱의 디버거 포트만 사용합니다. 앱을 띄운 뒤 README의 검증 절차로 실행합니다.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { connect } from './debug-client.mjs'

const renderer = await connect(Number(process.env.APIDOC_RENDERER_PORT ?? 9333))
const main = await connect(Number(process.env.APIDOC_MAIN_PORT ?? 9334))
assert.ok(process.env.APIDOC_TEST_USER_DATA_DIR, '검증용 임시 프로필을 APIDOC_TEST_USER_DATA_DIR로 지정해야 합니다.')
assert.equal(await main.evaluate("process.mainModule.require('node:path').resolve(process.mainModule.require('electron').app.getPath('userData'))"), path.resolve(process.env.APIDOC_TEST_USER_DATA_DIR), '검증용 프로필이 아닌 앱에는 테스트를 실행하지 않습니다.')
let dialogPatched = false
try {
  const versions = await renderer.evaluate('window.apidocDesktop?.versions')
  assert.equal(versions.electron, '45.4.1')
  assert.equal(versions.node, '24.22.3')
  assert.deepEqual(await renderer.evaluate('Object.keys(window.apidocDesktop).sort()'), ['onCloseRequested', 'respondToClose', 'versions', 'workspace'])
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

  // 실제 생성·IPC·파일 읽기는 통과시키고 네이티브 선택 응답만 테스트 폴더로 대체합니다.
  await main.evaluate(`desktopSmoke.originalOpen=process.mainModule.require('electron').dialog.showOpenDialog;desktopSmoke.workspaceFolder=process.mainModule.require('node:fs').mkdtempSync(process.mainModule.require('node:path').join(process.mainModule.require('node:os').tmpdir(),'apidoc-smoke-workspace-'));process.mainModule.require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[desktopSmoke.workspaceFolder]});true`)
  await click('.workspace-name')
  // 메뉴 선택 후 생성 폼은 실제 UI 경로로 진행합니다.
  await click('.workspace-create-action')
  await input('.workspace-name-input', 'Desktop smoke workspace')
  await click('.workspace-create-submit')
  for (let i = 0; i < 100; i++) {
    if (await renderer.evaluate(`document.querySelector('.workspace-session:not([hidden]) .workspace-selected-name')?.textContent==='Desktop smoke workspace'`)) { break }
    await delay(100)
  }
  assert.equal(await renderer.evaluate('document.querySelector(".workspace-session:not([hidden]) .request-toolbar")===null'), true)
  await closeAndCancel()
  assert.match(await main.evaluate('desktopSmoke.dialogs.at(-1).detail'), /미저장/)

  const secondExecutable = process.env.APIDOC_TEST_EXECUTABLE ?? path.resolve('out/APIDOC-win32-x64/APIDOC.exe')
  const secondArgs = process.env.APIDOC_TEST_USER_DATA_DIR ? [`--user-data-dir=${process.env.APIDOC_TEST_USER_DATA_DIR}`] : []
  const secondEnv = { ...process.env }
  // 빈 문자열도 Electron의 Node 모드를 활성화할 수 있으므로 키 자체를 제거합니다.
  delete secondEnv.ELECTRON_RUN_AS_NODE
  await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].minimize();true`)
  await delay(100)
  assert.equal(await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].isMinimized()`), true)
  const second = spawn(secondExecutable, secondArgs, { stdio: 'ignore', env: secondEnv })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { second.kill(); reject(new Error('중복 실행 프로세스가 종료되지 않았습니다.')) }, 5000)
    second.once('exit', (code) => { clearTimeout(timeout); if (code === 0) { resolve() } else { reject(new Error(`중복 실행 종료 코드 ${code}`)) } })
    second.once('error', (error) => { clearTimeout(timeout); reject(error) })
  })
  await delay(100)
  assert.equal(await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length`), 1)
  assert.equal(await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].isMinimized()`), false)

  // 최종 종료는 취소 분기와 동일한 실제 IPC를 사용하며 확인 응답만 1로 바꿉니다.
  await main.evaluate(`desktopSmoke.response=1;setImmediate(()=>process.mainModule.require('electron').app.quit());true`)
  await delay(500)
  console.log('Desktop smoke passed: packaged UI, runtime isolation, CSP, missing asset, new-window denial, running request, environment/collection drafts, unsaved cancel, hidden workspace, single instance, confirmed quit.')
} finally {
  if (dialogPatched) {
    try { await main.evaluate(`process.mainModule.require('electron').dialog.showMessageBox=desktopSmoke.original;if(desktopSmoke.originalOpen)process.mainModule.require('electron').dialog.showOpenDialog=desktopSmoke.originalOpen;true`) } catch { /* 종료된 앱에는 복구할 핸들이 없습니다. */ }
  }
  renderer.close()
  main.close()
}
