import fs from 'node:fs'
import path from 'node:path'
import type { OptionConstraint, WidgetCatalog } from './widgetCatalog.js'

export const FORM_ITEM_WRAPPER_REL =
  'v-form/src/components/form-designer/form-widget/field-widget/form-item-wrapper.vue'

export type RenderConventionScope = 'field' | 'form'

export type RenderConventionSpec = {
  id: string
  props: readonly string[]
  component: 'form-item-wrapper'
  sourceRel: typeof FORM_ITEM_WRAPPER_REL
  effect: string
  scopes: readonly RenderConventionScope[]
  inheritWhenEmpty?: boolean
  renderUnit?: string
  cssClass?: string
}

/** form-item-wrapper.vue 真源渲染约定 */
export const RENDER_CONVENTION_REGISTRY: Record<string, RenderConventionSpec> = {
  labelWidth: {
    id: 'form-item-label-width-px',
    props: ['labelWidth'],
    component: 'form-item-wrapper',
    sourceRel: FORM_ITEM_WRAPPER_REL,
    effect: ':label-width="labelWidth + \'px\'"；字段 null/0/labelHidden 时继承 formConfig.labelWidth',
    scopes: ['field', 'form'],
    inheritWhenEmpty: true,
    renderUnit: 'px',
  },
  labelAlign: {
    id: 'form-item-label-align-class',
    props: ['labelAlign'],
    component: 'form-item-wrapper',
    sourceRel: FORM_ITEM_WRAPPER_REL,
    effect: '!!options.labelAlign ? options.labelAlign : formConfig.labelAlign；作为 el-form-item class 生效',
    scopes: ['field'],
    inheritWhenEmpty: true,
    cssClass: 'label-left-align|label-center-align|label-right-align',
  },
  labelWrap: {
    id: 'form-item-label-wrap-class',
    props: ['labelWrap'],
    component: 'form-item-wrapper',
    sourceRel: FORM_ITEM_WRAPPER_REL,
    effect: '!!options.labelWrap → el-form-item class label-wrap（标签换行）',
    scopes: ['field'],
    cssClass: 'label-wrap',
  },
  labelHidden: {
    id: 'form-item-label-hidden-class',
    props: ['labelHidden'],
    component: 'form-item-wrapper',
    sourceRel: FORM_ITEM_WRAPPER_REL,
    effect: 'labelHidden → class label-hidden；label 置空且 labelWidth=0',
    scopes: ['field'],
    cssClass: 'label-hidden',
  },
  customClass: {
    id: 'form-item-custom-class',
    props: ['customClass'],
    component: 'form-item-wrapper',
    sourceRel: FORM_ITEM_WRAPPER_REL,
    effect: 'options.customClass 作为 el-form-item class（fieldMixin 运行时维护 string[] join）',
    scopes: ['field'],
  },
  required: {
    id: 'form-item-required-marker',
    props: ['required'],
    component: 'form-item-wrapper',
    sourceRel: FORM_ITEM_WRAPPER_REL,
    effect: 'required=true → el-form-item class required（红星 ::before）',
    scopes: ['field'],
    cssClass: 'required',
  },
}

export const RENDER_CONVENTION_PROPS = Object.keys(RENDER_CONVENTION_REGISTRY)

export type RenderConventionMeta = NonNullable<OptionConstraint['renderConvention']>

export function renderConventionCatalogBlock() {
  return {
    component: 'form-item-wrapper' as const,
    sourceRel: FORM_ITEM_WRAPPER_REL,
    rules: Object.values(RENDER_CONVENTION_REGISTRY).map((spec) => ({
      id: spec.id,
      props: [...spec.props],
      effect: spec.effect,
      ...(spec.inheritWhenEmpty !== undefined ? { inheritWhenEmpty: spec.inheritWhenEmpty } : {}),
      ...(spec.renderUnit ? { renderUnit: spec.renderUnit } : {}),
      ...(spec.cssClass ? { cssClass: spec.cssClass } : {}),
    })),
  }
}

function toRenderConventionMeta(spec: RenderConventionSpec): RenderConventionMeta {
  return {
    id: spec.id,
    component: spec.component,
    sourceRel: spec.sourceRel,
    effect: spec.effect,
    ...(spec.inheritWhenEmpty !== undefined ? { inheritWhenEmpty: spec.inheritWhenEmpty } : {}),
    ...(spec.renderUnit ? { renderUnit: spec.renderUnit } : {}),
    ...(spec.cssClass ? { cssClass: spec.cssClass } : {}),
  }
}

export function applyRenderConventionToConstraint(
  scope: RenderConventionScope,
  key: string,
  constraint: OptionConstraint,
): OptionConstraint {
  const spec = RENDER_CONVENTION_REGISTRY[key]
  if (!spec || !spec.scopes.includes(scope)) return constraint
  return {
    ...constraint,
    source: 'render-convention',
    ...(spec.renderUnit ? { unit: spec.renderUnit } : {}),
    renderConvention: toRenderConventionMeta(spec),
  }
}

export function applyRenderConventionConstraints(
  scope: RenderConventionScope,
  constraints: Record<string, OptionConstraint>,
): Record<string, OptionConstraint> {
  return Object.fromEntries(
    Object.entries(constraints).map(([key, constraint]) => [
      key,
      applyRenderConventionToConstraint(scope, key, constraint),
    ]),
  )
}

export function checkRenderConventionParity(root: string, catalog: WidgetCatalog): string[] {
  const issues: string[] = []
  const wrapperPath = path.join(root, FORM_ITEM_WRAPPER_REL)
  if (!fs.existsSync(wrapperPath)) {
    issues.push(`missing render source: ${FORM_ITEM_WRAPPER_REL}`)
  } else {
    const src = fs.readFileSync(wrapperPath, 'utf8')
    if (!src.includes("labelWidth + 'px'")) {
      issues.push('form-item-wrapper must bind labelWidth + px')
    }
    if (!src.includes('!!this.field.options.labelAlign')) {
      issues.push('form-item-wrapper must inherit labelAlign when field empty')
    }
    if (!src.includes("'label-wrap'")) {
      issues.push('form-item-wrapper must apply label-wrap class')
    }
  }

  if (!catalog.renderConventions?.rules?.length) {
    issues.push('catalog.renderConventions.rules missing')
  } else if (catalog.renderConventions.rules.length !== Object.keys(RENDER_CONVENTION_REGISTRY).length) {
    issues.push(
      `renderConventions rule count expected ${Object.keys(RENDER_CONVENTION_REGISTRY).length} got ${catalog.renderConventions.rules.length}`,
    )
  }

  const input = catalog.widgets.find((w) => w.type === 'input')
  for (const key of ['labelWidth', 'labelAlign', 'labelWrap', 'labelHidden', 'customClass', 'required'] as const) {
    const spec = RENDER_CONVENTION_REGISTRY[key]
    const constraint = input?.constraints[key]
    if (!constraint?.renderConvention) {
      issues.push(`input.${key} missing renderConvention metadata`)
      continue
    }
    if (constraint.renderConvention.id !== spec.id) {
      issues.push(`input.${key} renderConvention.id mismatch`)
    }
    if (constraint.source !== 'render-convention') {
      issues.push(`input.${key} render keys must source=render-convention`)
    }
  }

  const formLw = catalog.form.constraints.labelWidth
  if (!formLw?.renderConvention || formLw.renderConvention.id !== 'form-item-label-width-px') {
    issues.push('form.labelWidth missing renderConvention')
  }
  if (input?.constraints.labelWidth?.unit !== 'px') {
    issues.push('input.labelWidth must declare unit px')
  }

  return issues
}
