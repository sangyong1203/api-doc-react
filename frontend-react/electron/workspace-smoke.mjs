// 전용 프로필의 Electron에서 선택 응답 외의 UI·IPC·파일 처리를 실제 검증합니다.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { connect } from './debug-client.mjs'

const renderer = await connect(Number(process.env.APIDOC_RENDERER_PORT ?? 19433))
const main = await connect(Number(process.env.APIDOC_MAIN_PORT ?? 19434))
assert.ok(process.env.APIDOC_TEST_USER_DATA_DIR, '검증용 임시 프로필을 APIDOC_TEST_USER_DATA_DIR로 지정해야 합니다.')
assert.equal(await main.evaluate("process.mainModule.require('node:path').resolve(process.mainModule.require('electron').app.getPath('userData'))"), path.resolve(process.env.APIDOC_TEST_USER_DATA_DIR), '검증용 프로필이 아닌 앱에는 테스트를 실행하지 않습니다.')
const root = await mkdtemp(path.join(tmpdir(), 'apidoc-workspace-ui-'))
const folder = path.join(root, 'sample'), empty = path.join(root, 'new'), invalid = path.join(root, 'invalid')
await Promise.all([mkdir(folder), mkdir(empty), mkdir(invalid)])
const sample = JSON.parse(await readFile('../doc/storage-v1.samples.json', 'utf8')).valid.find(value => value.name === 'main').files
for (const [relative, data] of Object.entries(sample)) { const file = path.join(folder, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)) }
const manifestBefore = await readFile(path.join(folder, 'workspace.json'), 'utf8')
await writeFile(path.join(invalid, 'workspace.json'), '{invalid json')
let patched = false
const visible = '.workspace-session:not([hidden])'
async function wait(expression) {
  for (let attempt = 0; attempt < 150; attempt++) { if (await renderer.evaluate(expression)) { return }
    await delay(100) }
  throw new Error(`UI condition timeout: ${expression}`)
}
async function click(selector) {
  const point = await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  assert.ok(point, selector)
  await renderer.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await delay(100)
}
async function input(selector, value) {
  assert.equal(await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`), true)
  await delay(100)
}
async function openFolder(choice) {
  await main.evaluate(`workspaceSmoke.choices.push(${JSON.stringify(choice)});true`)
  await click(`${visible} .workspace-name`)
  await click('.workspace-open-action')
  await wait(`!document.querySelector(${JSON.stringify(`${visible} .workspace-name`)})?.disabled`)
}
try {
  await wait(`Boolean(window.apidocDesktop?.workspace && document.querySelector(${JSON.stringify(`${visible} .url-input`)}))`)
  await main.evaluate(`globalThis.workspaceSmoke={choices:[],original:process.mainModule.require('electron').dialog.showOpenDialog};process.mainModule.require('electron').dialog.showOpenDialog=async()=>{if(!workspaceSmoke.choices.length)throw Error('Missing test selection');const selected=workspaceSmoke.choices.shift();return {canceled:selected===null,filePaths:selected===null?[]:[selected]}};true`)
  patched = true
  await input(`${visible} .url-input`, '{{baseUrl}}/unsaved-demo')
  await openFolder(folder)
  await wait(`document.querySelector(${JSON.stringify(`${visible} .workspace-storage-badge`)})?.textContent==='폴더 연결'`)
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${visible} .request-save`)})?.disabled`), true)
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${visible} .request-send`)})?.disabled`), true)
  assert.equal(await renderer.evaluate(`document.querySelectorAll(${JSON.stringify(`${visible} .collection-request`)}).length`), 2)
  await mkdir('out', { recursive: true })
  const loadedCapture = await renderer.send('Page.captureScreenshot', { format: 'png' })
  await writeFile('out/workspace-loaded-smoke.png', Buffer.from(loadedCapture.data, 'base64'))
  await input(`${visible} .url-input`, '/unsaved-folder-edit')
  await openFolder(null)
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${visible} .url-input`)}).value`), '/unsaved-folder-edit')
  await openFolder(invalid)
  await wait(`Boolean(document.querySelector(${JSON.stringify(`${visible} .workspace-folder-error`)}))`)
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${visible} .url-input`)}).value`), '/unsaved-folder-edit')
  await click(`${visible} .workspace-name`)
  await click('.workspace-option:first-child')
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${visible} .url-input`)}).value`), '{{baseUrl}}/unsaved-demo')
  await click(`${visible} .workspace-name`)
  await click('.workspace-option:last-child')
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${visible} .url-input`)}).value`), '/unsaved-folder-edit')
  await main.evaluate(`workspaceSmoke.choices.push(${JSON.stringify(empty)});true`)
  await click(`${visible} .workspace-name`)
  await click('.workspace-create-action')
  await input('.workspace-name-input', '폴더 생성 테스트')
  await click('.workspace-create-submit')
  await wait(`document.querySelector(${JSON.stringify(`${visible} .workspace-selected-name`)})?.textContent==='폴더 생성 테스트'`)
  const created = JSON.parse(await readFile(path.join(empty, 'workspace.json'), 'utf8'))
  assert.equal(created.name, '폴더 생성 테스트'); assert.deepEqual(created.collections, [])
  assert.equal(await readFile(path.join(folder, 'workspace.json'), 'utf8'), manifestBefore)
  // 신뢰 경로는 Main 선택 응답으로만 공급하며 Renderer에는 공개하지 않습니다.
  await main.evaluate(`workspaceSmoke.choices.push(${JSON.stringify(folder)});true`)
  const opened = await renderer.evaluate(`window.apidocDesktop.workspace.open({requestId:${JSON.stringify(randomUUID())},payload:{source:'dialog'}})`)
  assert.equal(opened.ok, true)
  const oldHandle = opened.data.connection.handle
  const snapshot = await renderer.evaluate(`window.apidocDesktop.workspace.snapshot({requestId:${JSON.stringify(randomUUID())},payload:{handle:${JSON.stringify(oldHandle)}}})`)
  assert.equal(snapshot.ok, true)
  await mkdir('out', { recursive: true })
  const screenshot = await renderer.send('Page.captureScreenshot', { format: 'png' })
  await writeFile('out/workspace-smoke.png', Buffer.from(screenshot.data, 'base64'))
  await renderer.send('Page.reload')
  await wait(`Boolean(window.apidocDesktop?.workspace && document.querySelector(${JSON.stringify(`${visible} .url-input`)}))`)
  const stale = await renderer.evaluate(`window.apidocDesktop.workspace.snapshot({requestId:${JSON.stringify(randomUUID())},payload:{handle:${JSON.stringify(oldHandle)}}})`)
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'WORKSPACE_NOT_OPEN')
  console.log(JSON.stringify({ result: 'passed', fixture: root, checked: ['open', 'create', 'snapshot IPC', 'cancel/failure preservation', 'session draft preservation', 'file save/run disabled', 'reload invalidates handle'], screenshot: 'out/workspace-smoke.png' }))
} finally {
  if (patched) { try { await main.evaluate(`process.mainModule.require('electron').dialog.showOpenDialog=workspaceSmoke.original;true`) } catch { /* 앱이 종료된 경우 복원할 대상이 없습니다. */ } }
  try { await main.evaluate(`setImmediate(()=>process.mainModule.require('electron').app.quit());true`) } catch { /* 이미 종료된 경우입니다. */ }
  renderer.close(); main.close()
}
