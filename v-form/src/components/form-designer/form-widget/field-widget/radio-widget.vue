<template>
  <form-item-wrapper :designer="designer" :field="field" :rules="rules" :design-state="designState"
                     :parent-widget="parentWidget" :parent-list="parentList" :index-of-parent-list="indexOfParentList"
                     :sub-form-row-index="subFormRowIndex" :sub-form-col-index="subFormColIndex" :sub-form-row-id="subFormRowId">
    <el-radio-group ref="fieldEditor" v-model="cmpFieldModel" v-show="!isReadMode"
                    :disabled="field.options.disabled"
                    :style="{display: isReadMode ? 'none' : field.options.displayStyle + ' !important'}"
                    @change="handleChangeEvent">
      <template v-if="!!field.options.buttonStyle">
        <el-radio-button v-for="(item, index) in field.options.optionItems" :key="index" :label="item.value"
                         :disabled="item.disabled" :border="field.options.border"
                         :style="{display: field.options.displayStyle}">{{item.label}}</el-radio-button>
      </template>
      <template v-else>
        <el-radio v-for="(item, index) in field.options.optionItems" :key="index" :label="item.value"
                  :disabled="item.disabled" :border="field.options.border"
                  :style="{display: field.options.displayStyle}">{{item.label}}</el-radio>
      </template>
    </el-radio-group>
    <template v-if="isReadMode">
      <span class="readonly-mode-field">{{optionLabel}}</span>
    </template>
  </form-item-wrapper>
</template>

<script>
  import FormItemWrapper from './form-item-wrapper'
  import emitter from '@/utils/emitter'
  import i18n, {translate} from "@/utils/i18n";
  import fieldMixin from "@/components/form-designer/form-widget/field-widget/fieldMixin";
  import {deepClone} from "@/utils/util";

  export default {
    name: "radio-widget",
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
      FormItemWrapper,
    },
    data() {
      return {
        oldFieldValue: null, //field组件change之前的值
        fieldModel: null,
        rules: [],
      }
    },
    computed: {
      cmpFieldModel: {
        get() {
          if (this.fieldModel && this.fieldModel.value) {
            return this.fieldModel.value
          }

          return this.fieldModel
        },
        set(value) {
          this.fieldModel = value
        }
      },


    },
    beforeCreate() {
      /* 这里不能访问方法和属性！！ */
      //console.error('aa8383: ', this.fieldModel)
    },

    created() {
      /* 注意：子组件mounted在父组件created之后、父组件mounted之前触发，故子组件mounted需要用到的prop
         需要在父组件created中初始化！！ */
      this.registerToRefList()
      this.initOptionItems(false, this.initFieldModel)
      //this.initFieldModel()
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
      /*
        注意：VFormRender的setFormData方法不会触发子表单内field-widget的setValue方法，
        因为setFormData方法调用后，子表单内所有field-widget组件已被清空，接收不到setFormData事件！！
      */
      setValue(newValue, disableChangeEvent = false) {
        if (!!this.field.formItemFlag) {
          let realValue = newValue
          if (newValue && (newValue.value !== undefined)) { /* 解决radio组件绑定值为OptionModel对象的传值问题 */
            realValue = newValue.value
          }

          let oldValue = deepClone(this.fieldModel)
          this.fieldModel = realValue
          this.initFileList()

          this.syncUpdateFormModel(realValue)
          if (!disableChangeEvent) {
            this.emitFieldDataChange(realValue, oldValue)
          }
          this.oldFieldValue = realValue
        }
      },

    }
  }
</script>

<style lang="scss" scoped>
  @import "../../../../styles/global.scss"; /* form-item-wrapper已引入，还需要重复引入吗？ */

</style>
