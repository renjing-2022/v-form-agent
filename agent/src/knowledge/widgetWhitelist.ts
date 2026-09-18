import type { FieldType } from '../schemas/fieldPlan.js'
import type { ContainerCreateType } from './createWhitelistPolicy.js'

export {
  CONTAINER_CREATE_WHITELIST,
  CREATE_NON_GOAL,
  CREATE_NON_GOAL_REASON_LABEL,
  FIELD_CREATE_WHITELIST,
  FIELD_WHITELIST,
  REFINE_CREATE_WHITELIST,
  WIDGET_WHITELIST,
  checkCreateWhitelistCatalogParity,
  compareWidgetsConfigTypesWithCatalog,
  createNonGoalReason,
  createRejectMessageForType,
  isCreateAllowedType,
  type ContainerCreateType,
  type CreateNonGoalReason,
  type RefineCreateType,
} from './createWhitelistPolicy.js'

export const MAX_FIELDS = 120
export const MAX_DEPTH_HINT = 4

type FieldTemplate = {
  type: FieldType
  icon: string
  formItemFlag?: boolean
  options: Record<string, unknown>
}

type ContainerTemplate = {
  type: ContainerCreateType
  icon: string
  category: 'container'
  formItemFlag?: boolean
  options: Record<string, unknown>
}

const commonFieldOptions = {
  keyNameEnabled: false,
  keyName: '',
  labelAlign: '',
  labelWidth: null,
  labelHidden: false,
  labelWrap: false,
  disabled: false,
  hidden: false,
  required: false,
  requiredHint: '',
  validation: '',
  validationHint: '',
  customClass: '',
  labelIconClass: null,
  labelIconPosition: 'rear',
  labelTooltip: null,
  onCreated: '',
  onMounted: '',
  onChange: '',
  onValidate: '',
}

/**
 * @deprecated 新建节点请使用 `widgetDefaults.ts`（Catalog/widgetsConfig 克隆）。
 * 保留仅供历史对照；refine/assembler 已不再引用。
 */
export const widgetTemplates: Record<FieldType, FieldTemplate> = {
  input: {
    type: 'input',
    icon: 'text-field',
    formItemFlag: true,
    options: {
      ...commonFieldOptions,
      type: 'text',
      defaultValue: '',
      placeholder: '',
      columnWidth: '200px',
      size: '',
      clearable: true,
      showPassword: false,
      minLength: null,
      maxLength: null,
      showWordLimit: false,
      prefixIcon: '',
      suffixIcon: '',
      appendButton: false,
      appendButtonDisabled: false,
      buttonIcon: 'custom-search',
      appendText: false,
      textForAppend: '',
      onInput: '',
      onFocus: '',
      onBlur: '',
      onAppendButtonClick: '',
    },
  },
  textarea: {
    type: 'textarea',
    icon: 'textarea-field',
    formItemFlag: true,
    options: {
      ...commonFieldOptions,
      rows: 3,
      autosize: false,
      defaultValue: '',
      placeholder: '',
      columnWidth: '200px',
      size: '',
      minLength: null,
      maxLength: null,
      showWordLimit: false,
      onInput: '',
      onFocus: '',
      onBlur: '',
    },
  },
  number: {
    type: 'number',
    icon: 'number-field',
    formItemFlag: true,
    options: {
      ...commonFieldOptions,
      defaultValue: 0,
      placeholder: '',
      columnWidth: '200px',
      size: '',
      controls: true,
      formulaEnabled: false,
      formula: '',
      min: -100000000000,
      max: 100000000000,
      precision: 0,
      step: 1,
      controlsPosition: 'right',
      onFocus: '',
      onBlur: '',
    },
  },
  radio: {
    type: 'radio',
    icon: 'radio-field',
    formItemFlag: true,
    options: {
      ...commonFieldOptions,
      defaultValue: undefined,
      columnWidth: '200px',
      size: '',
      displayStyle: 'block',
      buttonStyle: false,
      border: false,
      dsEnabled: false,
      dsName: '',
      dataSetName: '',
      firstOptionAsDefault: false,
      labelKey: 'label',
      valueKey: 'value',
      optionValueType: '',
      optionItems: [],
    },
  },
  select: {
    type: 'select',
    icon: 'select-field',
    formItemFlag: true,
    options: {
      ...commonFieldOptions,
      defaultValue: undefined,
      placeholder: '',
      columnWidth: '200px',
      size: '',
      clearable: true,
      filterable: false,
      allowCreate: false,
      remote: false,
      automaticDropdown: false,
      multiple: false,
      multipleLimit: 0,
      collapseTags: false,
      dsEnabled: false,
      dsName: '',
      dataSetName: '',
      firstOptionAsDefault: false,
      labelKey: 'label',
      valueKey: 'value',
      optionValueType: '',
      optionItems: [],
      onFocus: '',
      onBlur: '',
    },
  },
  date: {
    type: 'date',
    icon: 'date-field',
    formItemFlag: true,
    options: {
      ...commonFieldOptions,
      type: 'date',
      defaultValue: null,
      placeholder: '',
      columnWidth: '200px',
      size: '',
      autoFullWidth: true,
      editable: false,
      clearable: true,
      format: 'YYYY-MM-DD',
      valueFormat: 'YYYY-MM-DD',
      onFocus: '',
      onBlur: '',
    },
  },
  'static-text': {
    type: 'static-text',
    icon: 'static-text',
    formItemFlag: false,
    options: {
      name: '',
      columnWidth: '200px',
      hidden: false,
      textContent: 'static text',
      customClass: '',
      onCreated: '',
      onMounted: '',
    },
  },
  divider: {
    type: 'divider',
    icon: 'divider',
    formItemFlag: false,
    options: {
      name: '',
      label: '',
      columnWidth: '200px',
      direction: 'horizontal',
      contentPosition: 'center',
      hidden: false,
      customClass: '',
      onCreated: '',
      onMounted: '',
    },
  },
}

/** @deprecated 新建容器请使用 `widgetDefaults.ts`（Catalog/widgetsConfig 克隆） */
export const containerTemplates: Record<ContainerCreateType, ContainerTemplate> = {
  tab: {
    type: 'tab',
    icon: 'tab',
    category: 'container',
    options: {
      name: '',
      tabType: 'border-card',
      tabPosition: 'top',
      hidden: false,
      customClass: '',
      onTabClick: '',
    },
  },
  'tab-pane': {
    type: 'tab-pane',
    icon: 'tab-pane',
    category: 'container',
    options: {
      name: '',
      label: '',
      hidden: false,
      active: false,
      disabled: false,
      customClass: '',
    },
  },
  grid: {
    type: 'grid',
    icon: 'column-2-grid',
    category: 'container',
    options: {
      name: '',
      hidden: false,
      gutter: 12,
      colHeight: null,
      customClass: '',
    },
  },
  'grid-col': {
    type: 'grid-col',
    icon: 'grid-col',
    category: 'container',
    options: {
      name: '',
      hidden: false,
      span: 12,
      offset: 0,
      push: 0,
      pull: 0,
      responsive: false,
      md: 12,
      sm: 12,
      xs: 24,
      customClass: '',
    },
  },
}

export function getDefaultFormConfig() {
  return {
    modelName: 'formData',
    refName: 'vForm',
    rulesName: 'rules',
    labelWidth: 120,
    labelPosition: 'left',
    h5LabelTop: true,
    gridResponsive: true,
    size: '',
    labelAlign: 'label-left-align',
    cssCode: '',
    customClass: [],
    functions: '',
    layoutType: 'PC',
    jsonVersion: 3,
    dataSources: [],
    onFormCreated: '',
    onFormMounted: '',
    onFormDataChange: '',
    onFormValidate: '',
  }
}
