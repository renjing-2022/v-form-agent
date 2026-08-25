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
    <div :class="[!!field.options.autoFullWidth ? 'auto-full-width' : '', isReadMode ? 'readonly-mode-date-range' : '']">
      <el-date-picker ref="fieldEditor"
                      :type="field.options.type"
                      v-model="fieldModel"
                      :key="dateRangeKey"
                      v-show="!isReadMode"
                      popper-class="hide-date-popper"
                      :class="[!!field.options.autoFullWidth ? 'auto-full-width' : '']"
                      :disabled="field.options.disabled"
                      :readonly="field.options.readonly"
                      :clearable="field.options.clearable"
                      :editable="field.options.editable"
                      :format="field.options.format"
                      :value-format="field.options.valueFormat"
                      :start-placeholder="field.options.startPlaceholder || i18nt('render.hint.startDatePlaceholder')"
                      :end-placeholder="field.options.endPlaceholder || i18nt('render.hint.endDatePlaceholder')"
                      @focus="handleDateFocusEvent"
                      @blur="handleBlurCustomEvent"
                      @change="handleChangeEvent">
      </el-date-picker>
      <Popup
          v-model:show="popupShowFlag"
          round
          position="bottom"
          class="select-popup">
        <van-picker-group
            v-if="popupShowFlag"
            :title="i18nt('render.hint.dateRange')"
            :tabs="[i18nt('render.hint.startDate'), i18nt('render.hint.endDate')]"
            :next-step-text="i18nt('render.hint.nextStep')"
            @cancel="onCancelPickerGroup"
            @confirm="onConfirmPickerGroup">
          <van-date-picker
              v-model="startDate"
              :min-date="minDate"
              :max-date="maxDate"
          />
          <van-date-picker
              v-model="endDate"
              :min-date="minDate"
              :max-date="maxDate"
          />
        </van-picker-group>
      </Popup>
      <template v-if="isReadMode">
        <span class="readonly-mode-field">{{contentForReadMode}}</span>
      </template>
    </div>
  </form-item-wrapper>
</template>

<script>
  import FormItemWrapper from './form-item-wrapper'
  import emitter from '@/utils/emitter'
  import i18n, {translate} from "@/utils/i18n";
  import fieldMixin from "@/components/form-designer/form-widget/field-widget/fieldMixin";
  import {generateId} from "@/utils/util";

  /**
   * Vant
   */
  import {Popup, PickerGroup, DatePicker} from "vant";
  import dayjs from "dayjs";

  export default {
    name: "vant-date-range-widget",
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
      FormItemWrapper, Popup, PickerGroup, DatePicker,
    },
    data() {
      return {
        oldFieldValue: null, //field组件change之前的值
        fieldModel: null,
        rules: [],

        popupShowFlag: false,
        startDate: ['2024', '01', '01'],
        endDate: ['2024', '07', '01'],
        minDate: new Date(1800, 0, 1),
        maxDate: new Date(2500, 11, 31),
      }
    },
    computed: {
      contentForReadMode() {
        if (!this.fieldModel) {
          return '--'
        } else {
          return this.fieldModel[0] + ' - ' + this.fieldModel[1]
        }
      },

      dateRangeKey() {
        return this.widgetKey || this.field.id
      },

    },
    beforeCreate() {
      /* 这里不能访问方法和属性！！ */
    },

    created() {
      /* 注意：子组件mounted在父组件created之后、父组件mounted之前触发，故子组件mounted需要用到的prop
         需要在父组件created中初始化！！ */
      this.registerToRefList()
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
      refreshWidgetKey() {  //强制刷新组件！！
        this.widgetKey = 'date-range-key-' + generateId()
      },

      handleDateFocusEvent(event) {
        this.handleFocusCustomEvent(event)

        if (this.field.options.validateConfig?.startType === "curDate") {
          this.minDate = new Date();
        } else if (this.field.options.validateConfig?.startDate) {
          this.minDate = new Date(this.field.options.validateConfig.startDate)
        }
        if (this.field.options.validateConfig?.endType === "curDate") {
          this.maxDate = new Date();
        } else if (this.field.options.validateConfig?.endDate) {
          this.maxDate = new Date(this.field.options.validateConfig.endDate)
        }

        if (this.fieldModel && (this.fieldModel.length === 2)) {
          let dateValue = dayjs(this.fieldModel[0], this.field.options.valueFormat)
          this.startDate = [dateValue.year(), dateValue.month() + 1, dateValue.date()]

          dateValue = dayjs(this.fieldModel[1], this.field.options.valueFormat)
          this.endDate = [dateValue.year(), dateValue.month() + 1, dateValue.date()]
        } else {
          let dateValue = dayjs()
          this.startDate = [dateValue.year(), dateValue.month() + 1, dateValue.date()]
          this.endDate = [dateValue.year(), dateValue.month() + 2, dateValue.date()]
        }

        this.popupShowFlag = true
      },

      onCancelPickerGroup(params) {
        this.popupShowFlag = false
      },

      onConfirmPickerGroup(params) {
        if ((this.startDate && this.startDate.length > 0)
          && (this.endDate && this.endDate.length > 0)) {
          if (this.fieldModel && this.fieldModel.length) {
            this.fieldModel.length = 0
          } else {
            this.fieldModel = []
          }
          const startDateValue = this.startDate.join('-')
          const endDateValue = this.endDate.join('-')
          if (startDateValue >= endDateValue) {
            this.$message.error(this.i18nt('render.hint.dateRangeValidation'))
            return
          }

          this.fieldModel.push(startDateValue)
          this.fieldModel.push(endDateValue)
          this.setValue(this.fieldModel)
        }

        this.popupShowFlag = false  //此行必须放在最后！！
      },

    }
  }
</script>

<style lang="scss" scoped>
  @import "../../../../styles/global.scss"; /* form-item-wrapper已引入，还需要重复引入吗？ */

  .full-width-input {
    width: 100% !important;
  }

  .auto-full-width {
    width: 100%;

    :deep(.el-date-editor) {
      width: 100% !important;
      padding-left: 0;
      padding-right: 0;
    }

    :deep(.el-range__icon) {
      margin-left: 10px;
    }
  }

  .readonly-mode-date-range {
    :deep(.el-range-editor) {
      display: none;
    }
  }

</style>
<style lang="scss">
.hide-date-popper {
  display: none !important;
}
</style>