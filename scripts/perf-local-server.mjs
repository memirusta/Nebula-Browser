import http from 'node:http'

const basePort = Number(process.argv[2] ?? 43100)
const tabCount = Number(process.argv[3] ?? 20)
if (!Number.isInteger(basePort) || !Number.isInteger(tabCount) ||
    basePort < 1024 || basePort + tabCount > 65536 ||
    tabCount < 1 || tabCount > 20) {
  throw new Error('Usage: node scripts/perf-local-server.mjs [basePort=43100] [tabCount=20]')
}

const servers = []
for (let index = 0; index < tabCount; index += 1) {
  const port = basePort + index
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Nebula benchmark ${index + 1}</title></head><body><main><h1>Benchmark tab ${index + 1}</h1><p>Static localhost page with no network dependencies or timers.</p></main></body></html>`
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    response.end(html)
  })
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
}

console.log(`Serving ${tabCount} isolated localhost origins on ports ${basePort}-${basePort + tabCount - 1}.`)
for (let index = 0; index < tabCount; index += 1) {
  console.log(`http://127.0.0.1:${basePort + index}/`)
}

const shutdown = () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
process.once('SIGINT', () => { void shutdown().then(() => process.exit(0)) })
process.once('SIGTERM', () => { void shutdown().then(() => process.exit(0)) })
