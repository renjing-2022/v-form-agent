import type { InteractionScenario } from '../schemas/interactionOutput.js'

/** 由场景数据确定性渲染中文描述（用户确认页展示） */
export function narrateScenario(sc: InteractionScenario): string {
  const parts: string[] = [`【${sc.title}】`]
  if (sc.arrange?.values && Object.keys(sc.arrange.values).length) {
    const vals = Object.entries(sc.arrange.values)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('，')
    parts.push(`预置：${vals}`)
  }
  if (sc.arrange?.activeTab !== undefined) {
    parts.push(`当前页：${sc.arrange.activeTab}`)
  }
  if (sc.act?.length) {
    const acts = sc.act.map((a) => {
      if ('input' in a) return `输入 ${a.input}=${JSON.stringify(a.value)}`
      if ('click' in a) return `点击 ${a.click}`
      if ('switchTab' in a) return `切换到 ${a.switchTab}`
      if ('mount' in a) return '装载表单'
      if ('addSubFormRow' in a) return `子表 ${a.addSubFormRow} 增行`
      if ('submit' in a) return '提交校验'
      if ('wait' in a) return `等待 ${a.wait}ms`
      return '操作'
    })
    parts.push(`操作：${acts.join(' → ')}`)
  }
  const asserts = sc.assert.map((a) => {
    if ('noNetwork' in a) return '无网络请求'
    if ('noError' in a) return '无运行错误'
    if ('field' in a && 'value' in a) return `${a.field}=${JSON.stringify(a.value)}`
    if ('field' in a && 'hidden' in a) return `${a.field} hidden=${a.hidden}`
    if ('field' in a && 'disabled' in a) return `${a.field} disabled=${a.disabled}`
    if ('field' in a && 'required' in a) return `${a.field} required=${a.required}`
    if ('field' in a && 'label' in a) return `${a.field} label=${a.label}`
    if ('activeTab' in a) return `当前页=${a.activeTab}`
    if ('focused' in a) return `焦点=${a.focused}`
    if ('valid' in a) return `校验=${a.valid ? '通过' : '失败'}`
    if ('dialogVisible' in a) return `弹窗 ${a.dialogVisible} 可见=${a.value}`
    if ('subFormRows' in a) return `子表 ${a.subFormRows} 行数=${a.count}`
    return '断言'
  })
  parts.push(`期望：${asserts.join('；')}`)
  return parts.join('。')
}

export function narrateScenarios(scenarios: InteractionScenario[]): string[] {
  return scenarios.map(narrateScenario)
}
