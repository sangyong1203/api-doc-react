import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isAppCloseState, isTrustedAppUrl, isTrustedIpcSender } = require('../dist-electron/electron/ipc-security.cjs')

test('배포 URL은 고정 프로토콜·host를 사용하고 유사 주소·다른 출처는 거부한다', () => {
  for (const url of ['apidoc://app/', 'apidoc://app/workspace?selected=1#api']) {
    assert.equal(isTrustedAppUrl(url, null), true, url)
  }
  for (const url of ['apidoc://app.evil/', 'apidoc://app:80/', 'apidoc://user@app/', 'apidoc://app@evil/', 'apidoc://app./', 'https://app/', 'file:///app/index.html', 'about:blank', 'null', '', 'javascript:alert(1)']) {
    assert.equal(isTrustedAppUrl(url, null), false, url)
  }
})

test('개발 URL은 설정된 127.0.0.1 HTTP origin만 허용한다', () => {
  const dev = 'http://127.0.0.1:5176/'
  assert.equal(isTrustedAppUrl('http://127.0.0.1:5176/workspace?api=1', dev), true)
  for (const url of ['http://localhost:5176/', 'http://127.0.0.1:5177/', 'https://127.0.0.1:5176/', 'http://user@127.0.0.1:5176/', 'http://127.0.0.1:5176.evil/', 'apidoc://app/']) {
    assert.equal(isTrustedAppUrl(url, dev), false, url)
  }
  for (const config of ['https://example.com/', 'http://localhost:5176/', 'http://user@127.0.0.1:5176/', 'http://127.0.0.1:5176/other', 'http://127.0.0.1:5176/?x=1', 'http://127.0.0.1:5176/#x', 'invalid']) {
    assert.equal(isTrustedAppUrl('http://127.0.0.1:5176/', config), false, config)
  }
})

test('같은 URL이어도 다른 창·iframe·분리된 프레임의 IPC는 거부한다', () => {
  const frame = { url: 'apidoc://app/' }
  const owner = { mainFrame: frame, isDestroyed: () => false }
  assert.equal(isTrustedIpcSender({ sender: owner, senderFrame: frame }, owner, null), true)
  assert.equal(isTrustedIpcSender({ sender: {}, senderFrame: frame }, owner, null), false)
  assert.equal(isTrustedIpcSender({ sender: owner, senderFrame: { url: frame.url } }, owner, null), false)
  assert.equal(isTrustedIpcSender({ sender: owner, senderFrame: null }, owner, null), false)
  assert.equal(isTrustedIpcSender({ sender: owner, senderFrame: frame }, null, null), false)
  const destroyed = { mainFrame: frame, isDestroyed: () => true }
  assert.equal(isTrustedIpcSender({ sender: destroyed, senderFrame: frame }, destroyed, null), false)
  const detached = { get mainFrame() { throw new Error('detached frame') }, isDestroyed: () => false }
  assert.equal(isTrustedIpcSender({ sender: detached, senderFrame: frame }, detached, null), false)
})

test('주 프레임이 외부 주소로 바뀌면 기존 창 객체라도 IPC를 거부한다', () => {
  const frame = { url: 'https://example.com/' }
  const owner = { mainFrame: frame, isDestroyed: () => false }
  assert.equal(isTrustedIpcSender({ sender: owner, senderFrame: frame }, owner, null), false)
})

test('종료 상태는 두 boolean만 받고 coercion·상속·추가 필드를 허용하지 않는다', () => {
  for (const dirty of [true, false]) {
    for (const running of [true, false]) {
      assert.equal(isAppCloseState({ dirty, running }), true)
    }
  }
  assert.equal(isAppCloseState(Object.assign(Object.create(null), { dirty: false, running: false })), true)
  for (const state of [null, undefined, [], '', 0, true, {}, { dirty: false }, { running: false }, { dirty: 'false', running: false }, { dirty: 0, running: false }, { dirty: false, running: null }, { dirty: false, running: false, path: '../workspace.json' }, Object.create({ dirty: false, running: false }), new Date()]) {
    assert.equal(isAppCloseState(state), false)
  }
})
