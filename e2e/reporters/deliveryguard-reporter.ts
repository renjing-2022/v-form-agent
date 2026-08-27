import type {
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repositoryRoot = path.resolve(__dirname, '../..')
const version = process.env.EVIDENCE_VERSION || 'v0.1.0'
const evidenceDir = path.join(repositoryRoot, 'docs', 'evidence', version)

function gitOutput(args: string[]) {
  try {
    return execFileSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

function sourceRevision() {
  const branch = gitOutput(['branch', '--show-current'])
  const revision = gitOutput(['rev-parse', '--short=12', 'HEAD'])
  const dirty = gitOutput(['status', '--porcelain']) !== ''
  return `${branch || 'detached'}@${revision}${dirty ? ' (working tree has uncommitted changes)' : ''}`
}

function attachmentText(result: TestResult, name: string) {
  const attachment = result.attachments.find((item) => item.name === name)
  if (!attachment) return ''
  if (attachment.body) return attachment.body.toString('utf8').trim()
  return ''
}

function persistScreenshot(caseId: string, result: TestResult) {
  const attachment = result.attachments.find(
    (item) => item.name === 'deliveryguard-screenshot',
  )
  if (!attachment) return ''

  const filename = `${caseId}.png`
  const destination = path.join(evidenceDir, filename)
  if (attachment.body) {
    writeFileSync(destination, attachment.body)
  } else if (attachment.path && existsSync(attachment.path)) {
    copyFileSync(attachment.path, destination)
  } else {
    return ''
  }
  return `docs/evidence/${version}/${filename}`
}

class DeliveryGuardReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    const caseId = test.annotations.find((item) => item.type === 'case-id')?.description
    if (!caseId) return

    mkdirSync(evidenceDir, { recursive: true })
    const screenshot = persistScreenshot(caseId, result)
    const observed =
      attachmentText(result, 'observed') ||
      result.error?.message?.split('\n')[0] ||
      'No observation was attached'
    const status =
      result.status === 'passed'
        ? 'pass'
        : result.status === 'skipped'
          ? 'skipped'
          : 'fail'

    const lines = [
      `case: ${caseId}`,
      `status: ${status}`,
      `observed: ${observed}`,
      'environment: Playwright Chromium; local Windows; agent mock mode; v-form:3130; agent:3140',
      `sourceRevision: ${sourceRevision()}`,
      `capturedAt: ${new Date().toISOString()}`,
      `durationMs: ${result.duration}`,
    ]
    if (screenshot) lines.push(`screenshot: ${screenshot}`)
    if (result.error?.message) {
      lines.push(`error: ${result.error.message.split('\n')[0]}`)
    }

    writeFileSync(
      path.join(evidenceDir, `${caseId}.txt`),
      `${lines.join('\n')}\n`,
      'utf8',
    )
  }
}

export default DeliveryGuardReporter
