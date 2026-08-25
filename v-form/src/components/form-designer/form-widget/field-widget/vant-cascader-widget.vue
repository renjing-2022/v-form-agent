<template>
  <form-item-wrapper :designer="designer"
                     :field="field"
                     :rules="rules"
                     :design-state="designState"
                     :parent-widget="parentWidget"
                     :parent-list="parentList"
                     :index-of-parent-list="indexOfParentList"
                     :sub-form-row-index="subFormRowIndex"
                     :sub-form-col-index="subFormColIndex"
                     :sub-form-row-id="subFormRowId">
    <div class="full-width-input" :class="{'readonly-mode-cascader' : isReadMode}">
      <el-cascader ref="fieldEditor"
                   :options="cascaderOptions"
                   v-model="fieldModel"
                   popper-class="hide-cascader-popper"
                   :disabled="field.options.disabled || isReadMode"
                   :clearable="field.options.clearable"
                   :filterable="field.options.filterable"
                   :placeholder="field.options.placeholder || i18nt('render.hint.selectPlaceholder')"
                   :show-all-levels="showFullPath"
                   :props="{ checkStrictly: field.options.checkStrictly, multiple: field.options.multiple, expandTrigger: 'hover', value: valueKey, label: labelKey, children: childrenKey }"
                   @visible-change="hideDropDownOnClick"
                   @expand-change="hideDropDownOnClick"
                   @focus="handleCascaderFocusEvent"
                   @blur="handleBlurCustomEvent"
                   @change="handleChangeEvent">
      </el-cascader>
      <Popup
          v-model:show="popupShowFlag"
          round
          position="bottom"
          class="select-popup">
        <van-cascader
            v-model="vantCascaderValue"
            :title="i18nt('render.hint.select')"
            :options="vantCascaderOptions"
            :field-names="cascaderFieldNames"
            :show-checkbox="true"
            @change="onCascaderSelected"
            @close="onCloseCascader"
            @finish="onFinishCascader"
        >
          <template v-slot:option="{ option }" v-if="field.options.multiple">
            <div class="option-wrapper">
              <van-checkbox :modelValue="isSelected(option)" :disabled="option.disabled" shape="square" icon-size="14px">
                {{ option.label }}
              </van-checkbox>
            </div>
          </template>
        </van-cascader>
      </Popup>
      <template v-if="isReadMode">
        <span class="readonly-mode-field">{{getContentForReadMode()}}</span>
      </template>
    </div>
  </form-item-wrapper>
</template>

<script>
  import FormItemWrapper from './form-item-wrapper'
  import emitter from '@/utils/emitter'
  import i18n, {translate} from "@/utils/i18n";
  import fieldMixin from "@/components/form-designer/form-widget/field-widget/fieldMixin";
  import {
    pcTextArr,
    pcaTextArr,
  } from "element-china-area-data";


  /**
   * Vant
   */
  import {Popup, Cascader, Checkbox} from "vant";
  import {deepClone} from "@/utils/util";

  export default {
    name: "vant-cascader-widget",
    componentName: 'FieldWidget',  //必须固定为FieldWidget，用于接收父级组件的broadcast事件
    mixins: [emitter, fieldMixin, i18n],
    props: {
      field: Object,
      parentWidget: Object,
      parentList: Array,
      indexOfParentList: Number,
      designer: Object,

      designState: {
        type: Boolean,
        default: false
      },

      subFormRowIndex: { /* 子表单组件行索引，从0开始计数 */
        type: Number,
        default: -1
      },
      subFormColIndex: { /* 子表单组件列索引，从0开始计数 */
        type: Number,
        default: -1
      },
      subFormRowId: { /* 子表单组件行Id，唯一id且不可变 */
        type: String,
        default: ''
      },

    },
    components: {
      FormItemWrapper, Popup, Cascader, Checkbox,
    },
    data() {
      return {
        oldFieldValue: null, //field组件change之前的值
        fieldModel: null,
        rules: [],

        popupShowFlag: false,
        vantCascaderValue: '',
        cascaderFieldNames: {text: 'label', value: 'value', children: 'children'},
      }
    },
    computed: {
      labelKey() {
        return this.field.options.labelKey || 'label'
      },

      valueKey() {
        return this.field.options.valueKey || 'value'
      },

      childrenKey() {
        return this.field.options.childrenKey || 'children'
      },

      showFullPath() {
        return (this.field.options.showAllLevels === undefined) || !!this.field.options.showAllLevels
      },

      /* 计算属性会被缓存，已弃用，改用getContentForReadMode方法！！ */
      // contentForReadMode() {
      //   let onlyLeafFlag = !this.field.options.checkStrictly
      //   let checkedNodes = this.$refs.fieldEditor.getCheckedNodes(onlyLeafFlag)
      //   if (!checkedNodes || (checkedNodes.length <= 0)) {
      //     return '--'
      //   } else {
      //     return checkedNodes.map(nodeItem => nodeItem.text).join(", ")
      //   }
      // },

      cascaderOptions() {
        if (this.field.options.areaDataEnabled && (this.field.options.areaDataType === 1)) {
          return pcTextArr
        } else if (this.field.options.areaDataEnabled && (this.field.options.areaDataType === 2)) {
          return pcaTextArr
        }

        return this.field.options.optionItems
      },

      vantCascaderOptions() {
        const optionItems = deepClone(this.cascaderOptions);
        const setFullPath = (optionItem, parentItem) => {
          optionItem.forEach(item => {
            item.fullValue = [...parentItem, item.value];
            if (item.children) {
              setFullPath(item.children, item.fullValue);
            }
          });
        };
        setFullPath(optionItems, []);

        return optionItems;
      },

    },
    beforeCreate() {
      /* 这里不能访问方法和属性！！ */
    },

    created() {
      /* 注意：子组件mounted在父组件created之后、父组件mounted之前触发，故子组件mounted需要用到的prop
         需要在父组件created中初始化！！ */
      this.registerToRefList()
      this.initOptionItems()
      this.initFieldModel()
      this.initEventHandler()
      this.buildFieldRules()

      this.handleOnCreated()
    },

    mounted() {
      this.handleOnMounted()
    },

    beforeUnmount() {
      this.unregisterFromRefList()
    },

    methods: {
      /* 开启任意级节点可选后，点击radio隐藏下拉框 */
      hideDropDownOnClick() {
        setTimeout(() => {
          document.querySelectorAll(".el-cascader-panel .el-radio").forEach((el) => {
            el.onclick = () => {
              this.$refs.fieldEditor.popperVisible = false // 单选框部分点击隐藏下拉框
            }
          })
        }, 100)
      },

      getContentForReadMode() {
        if (this.field.options.areaDataEnabled && this.fieldModel && this.fieldModel.length > 0) {
          return this.fieldModel.join("/")
        }

        let checkedNodes = []
        if (this.$refs.fieldEditor) {
          checkedNodes = this.$refs.fieldEditor.getCheckedNodes(false)
        }

        if (!checkedNodes || (checkedNodes.length <= 0)) {
          return '--'
        } else {
          return checkedNodes.map(node => node.text).join(", ")
        }
      },

      handleCascaderFocusEvent(event) {
        this.handleFocusCustomEvent(event)

        if (this.fieldModel && (this.fieldModel.length > 0)) {
          this.vantCascaderValue = this.fieldModel[this.fieldModel.length - 1]
        }
        this.popupShowFlag = true
      },

      onCloseCascader() {
        this.popupShowFlag = false
      },

      onFinishCascader({ value, selectedOptions }) {
        if (!this.fieldModel) this.fieldModel = [];
        if (this.field.options.multiple) {
          this.handleChangeEvent(this.fieldModel);
        } else {
          this.fieldModel = selectedOptions.map(x => x['value']);
          this.handleChangeEvent(this.fieldModel);

          this.popupShowFlag = false  //此行必须放在最后！！
        }
      },

      isSelected(option) {
        let selected = false;
        let optionLastValue = option.fullValue[option.fullValue.length - 1];
        for (let i = 0; i < this.fieldModel.length; i++) {
          const x = this.fieldModel[i];
          selected = selected || x.indexOf(optionLastValue) >= 0;
        }

        return selected;
      },

      // 判断两个数组值相等
      arraysEqual(arr1, arr2) {
        if (arr1.length !== arr2.length) {
          return false;
        }
        for (let i = 0; i < arr1.length; i++) {
          if (arr1[i] !== arr2[i]) {
            return false;
          }
        }
        return true;
      },

      onCascaderSelected({ selectedOptions, tabIndex, value }) {
        // 如果选择的不是最后一级不执行
        if (selectedOptions[selectedOptions.length - 1].children && selectedOptions[selectedOptions.length - 1].children.length > 0)
          return;

        if (this.field.options.multiple) {
          let selectedItem = selectedOptions.map(option => option.value);
          let existIndex = -1;
          for (let i = 0; i < this.fieldModel.length; i++) {
            if (this.arraysEqual(this.fieldModel[i], selectedItem)) {
              existIndex = i;
              break;
            }
          }

          if (existIndex >= 0) {
            this.fieldModel.splice(existIndex, 1);
          } else {
            this.fieldModel.push(selectedItem);
            this.vantCascaderValue = this.fieldModel.map(fieldModelItem => fieldModelItem.join('_')).join(',');
          }
        } else {
          this.fieldModel = selectedOptions.map(option => option.value);
          this.vantCascaderValue = this.fieldModel.join('_');
        }
      },

    }
  }
</script>

<style lang="scss" scoped>
  @import "../../../../styles/global.scss"; /* form-item-wrapper已引入，还需要重复引入吗？ */

  .full-width-input {
    width: 100% !important;

    :deep(.el-cascader) {
      width: 100% !important;
    }
  }

  .readonly-mode-cascader :deep(.el-cascader) {
    display: none;
  }

</style>
<style lang="scss">
.hide-cascader-popper {
  display: none !important;
}
</style>