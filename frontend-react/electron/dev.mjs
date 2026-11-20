import { spawn } from 'node:child_process'
import electron from 'electron'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 5176 } })
await server.listen()
const address = server.httpServer.address()
if (!address || typeof address === 'string') {
  await server.close()
  throw new Error('Electron 개발 서버 주소를 확인할 수 없습니다.')
}
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.', `--dev-url=http://127.0.0.1:${address.port}/`, ...process.argv.slice(2)], { stdio: 'inherit', env })
let stopping = false
async function stop(code) {
  if (stopping) { return }
  stopping = true
  if (child.exitCode === null) { child.kill() }
  await server.close()
  process.exitCode = code
}
child.once('exit', (code) => { void stop(code ?? 1) })
child.once('error', (error) => { console.error(error); void stop(1) })
process.once('SIGINT', () => { void stop(0) })
process.once('SIGTERM', () => { void stop(0) })
