/**
 * v0.13 任务组 2：大表分片索引、意图检索、coverage、目标歧义、全图校验
 */
import { loadInteractionFixture } from '../fixtures/interaction/forms.js'
import { buildFormIndex, findAmbiguousTargetMentions, retrieveFormContext } from '../src/services/formIndex.js'
import {
  buildFormSummary,
  buildFormSummaryReport,
  FORM_SUMMARY_MAX_FIELDS,
  indexFormFields,
} from '../src/services/formSummary.js'
import { buildTargetAmbiguityGate } from '../src/services/targetAmbiguityGate.js'
import { validateFullCanvas } from '../src/services/interactionApply.js'
import type { FormJson } from '../src/schemas/refinePlan.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function nestDeep(depth: number, leafName: string): unknown {
  if (depth <= 0) {
    return {
      type: 'input',
      id: leafName,
      options: { name: leafName, label: leafName },
    }
  }
  return {
    type: 'grid',
    id: `g${depth}`,
    options: { name: `g${depth}`, label: `g${depth}` },
    cols: [
      {
        type: 'grid-col',
        options: { span: 24 },
        widgetList: [nestDeep(depth - 1, leafName)],
      },
    ],
  }
}

function buildLargeForm(nodeCount: number): FormJson {
  const widgetList: unknown[] = []
  // 两个同名 label「备注」用于歧义
  widgetList.push({
    type: 'input',
    id: 'remark_a',
    options: { name: 'remark_a', label: '备注' },
  })
  widgetList.push({
    type: 'textarea',
    id: 'remark_b',
    options: { name: 'remark_b', label: '备注' },
  })
  for (let i = 0; i < nodeCount - 2; i++) {
    widgetList.push({
      type: 'input',
      id: `f${i}`,
      options: { name: `f${i}`, label: `字段${i}` },
    })
  }
  return { widgetList: widgetList as FormJson['widgetList'], formConfig: {} }
}

function main() {
  const fo = loadInteractionFixture('F-order')
  const index = buildFormIndex(fo)
  assert(index.nodes.length >= 5, 'F-order indexed')
  assert(index.fingerprint.length === 64, 'index fingerprint')
  assert(index.byName.get('qty')?.length === 1, 'byName qty')

  const large = buildLargeForm(150)
  const largeIndex = buildFormIndex(large)
  assert(largeIndex.nodes.length === 150, `full index 150 got ${largeIndex.nodes.length}`)
  assert(largeIndex.maxDepth === 0, 'flat form depth 0')

  const allFields = indexFormFields(large)
  assert(allFields.length === 150, 'indexFormFields no silent truncate')

  const report = buildFormSummaryReport(large, '把字段70和字段71设为必填')
  assert(report.coverage.indexedNodes === 150, 'coverage indexed')
  assert(report.coverage.includedNodes <= FORM_SUMMARY_MAX_FIELDS, 'summary budget')
  assert(report.coverage.truncated, 'large form truncated visibly')
  assert(report.omissions.length >= 1, 'omissions present')
  assert(report.fingerprint === largeIndex.fingerprint, 'report fp == index fp')
  const names = new Set(report.fields.map((f) => f.name))
  assert(names.has('f70') || names.has('f71'), 'retrieval keeps intent targets')

  // 兼容旧 API：返回切片而非全量
  const legacy = buildFormSummary(large, '字段70')
  assert(legacy.length <= FORM_SUMMARY_MAX_FIELDS, 'legacy summary budget')

  const deep = {
    widgetList: [nestDeep(10, 'deepLeaf')],
    formConfig: {},
  } as FormJson
  const deepIndex = buildFormIndex(deep)
  assert(deepIndex.maxDepth >= 10, `index beyond depth 8, got ${deepIndex.maxDepth}`)
  assert(
    deepIndex.nodes.some((n) => n.name === 'deepLeaf'),
    'deep leaf indexed',
  )

  const retrieved = retrieveFormContext(deepIndex, '修改 deepLeaf 的标签')
  assert(retrieved.hitKeys.some((k) => deepIndex.byKey.get(k)?.name === 'deepLeaf'), 'retrieve deep leaf')
  assert(retrieved.selectedKeys.length >= 2, 'ancestors expanded')

  const amb = findAmbiguousTargetMentions(largeIndex, '把备注改成必填')
  assert(amb.some((a) => a.mention === '备注' && a.matches.length >= 2), 'ambiguous 备注')

  const gate = buildTargetAmbiguityGate({
    instruction: '把备注改成必填并联动',
    formJson: large,
  })
  assert(!gate.ok && gate.kind === 'need_clarification', 'target ambiguity → clarify')
  assert(gate.clarification.questions[0]?.binds?.slot === 'target.widget', 'binds target.widget')

  const clarified = buildTargetAmbiguityGate({
    instruction: '把备注改成必填\n已确认槽位：{"target.widget":"remark_a"}',
    formJson: large,
  })
  assert(clarified.ok, 'confirmed slot skips ambiguity')

  // 合法小表全图校验应通过
  const canvasOk = validateFullCanvas(fo)
  assert(canvasOk.length === 0, `F-order canvas ok: ${canvasOk.join(';')}`)

  // 重复 id 应失败
  const dup = JSON.parse(JSON.stringify(fo)) as FormJson
  const first = dup.widgetList[0] as { id?: string }
  const second = dup.widgetList[1] as { id?: string }
  second.id = first.id
  const canvasBad = validateFullCanvas(dup)
  assert(canvasBad.some((m) => /duplicate widget id/.test(m)), 'duplicate id caught')

  console.log('FORM_CONTEXT_T2_OK')
}

main()
