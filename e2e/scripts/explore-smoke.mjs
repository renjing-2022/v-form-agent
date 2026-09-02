import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(repositoryRoot, 'docs', 'exploratory', 'local-smoke')
const screenshot = path.join(outDir, 'ai-panel.png')
const target = process.env.EXPLORE_BASE_URL || 'http://127.0.0.1:3130'

mkdirSync(outDir, { recursive: true })

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const check = spawnSync('agent-browser', ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
if (check.status !== 0) {
  console.error(
    'agent-browser is not available. Install with: npm install -g agent-browser && agent-browser install',
  )
  process.exit(1)
}

run('agent-browser', [
  'batch',
  '--bail',
  `open ${target}`,
  'snapshot -i -s #formWidgetCanvas',
  'find role tab click --name AI',
  'snapshot -i -s .ai-agent-panel',
  `screenshot ${screenshot}`,
])

console.log(`Exploratory smoke finished. Screenshot: docs/exploratory/local-smoke/ai-panel.png`)
console.log('This is not DeliveryGuard acceptance evidence. Run: cd e2e && npm test')
