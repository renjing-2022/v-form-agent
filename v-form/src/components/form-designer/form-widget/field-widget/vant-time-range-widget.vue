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
    <div :class="[!!field.options.autoFullWidth ? 'auto-full-width' : '', isReadMode ? 'readonly-mode-time-range' : '']">
      <el-time-picker ref="fieldEditor"
                      is-range
                      v-model="fieldModel"
                      v-show="!isReadMode"
                      popper-class="hide-time-popper"
                      :class="[!!field.options.autoFullWidth ? 'full-width-input' : '']"
                      :disabled="field.options.disabled"
                      :readonly="field.options.readonly"
                      :clearable="field.options.clearable"
                      :editable="field.options.editable"
                      :format="field.options.format"
                      value-format="HH:mm:ss"
                      :start-placeholder="field.options.startPlaceholder || i18nt('render.hint.startTimePlaceholder')"
                      :end-placeholder="field.options.endPlaceholder || i18nt('render.hint.endTimePlaceholder')"
                      @focus="handleTimeFocusEvent"
                      @blur="handleBlurCustomEvent"
                      @change="handleChangeEvent">
      </el-time-picker>
      <Popup
          v-if="popupShowFlag"
          v-model:show="popupShowFlag"
          round
          position="bottom"
          class="select-popup">
        <van-picker-group
            :title="i18nt('render.hint.timeRange')"
            :tabs="[i18nt('render.hint.startTime'), i18nt('render.hint.endTime')]"
            :next-step-text="i18nt('render.hint.nextStep')"
            @cancel="onCancelPickerGroup"
            @confirm="onConfirmPickerGroup">
          <van-time-picker
              v-model="startTime"
              :columns-type="columnsType"
              :min-time="minTime"
              :max-time="maxTime"
          />
          <van-time-picker
              v-model="endTime"
              :columns-type="columnsType"
              :min-time="minTime"
              :max-time="maxTime"
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

  /**
   * Vant
   */
  import {Popup, PickerGroup, TimePicker} from "vant";

  export default {
    name: "vant-time-range-widget",
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
      FormItemWrapper, Popup, PickerGroup, TimePicker
    },
    data() {
      return {
        oldFieldValue: null, //field组件change之前的值
        fieldModel: null,
        rules: [],

        popupShowFlag: false,
        columnsType: ['hour', 'minute', 'second'],
        startTime: ['09', '30', '00'],
        endTime: ['18', '00', '00'],
        minTime: '00:00:00',
        maxTime: '23:59:59',
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
      handleTimeFocusEvent(event) {
        this.handleFocusCustomEvent(event)

        if (this.field.options.validateConfig?.startTime) {
          this.minTime = this.field.options.validateConfig.startTime
        }
        if (this.field.options.validateConfig?.endTime) {
          this.maxTime = this.field.options.validateConfig.endTime
        }

        if (this.fieldModel && (this.fieldModel.length === 2)) {
          let timeParts = this.fieldModel[0].split(':')
          if (timeParts.length === 3) {
            this.startTime = [timeParts[0], timeParts[1], timeParts[2]]
          }

          timeParts = this.fieldModel[1].split(':')
          if (timeParts.length === 3) {
            this.endTime = [timeParts[0], timeParts[1], timeParts[2]]
          }
        }
        this.popupShowFlag = true
      },

      onCancelPickerGroup(params) {
        this.popupShowFlag = false
      },

      onConfirmPickerGroup(params) {
        if ((this.startTime && this.startTime.length > 0)
            && (this.endTime && this.endTime.length > 0)) {
          if (this.fieldModel && this.fieldModel.length) {
            this.fieldModel.length = 0
          } else {
            this.fieldModel = []
          }
          this.fieldModel.push(this.startTime.join(':'))
          this.fieldModel.push(this.endTime.join(':'))
          this.setValue(this.fieldModel)
        }

        this.popupShowFlag = false  //此行必须放在最后！！
      },

    }
  }
</script>

<style lang="scss" scoped>
  @import "../../../../styles/global.scss"; /* form-item-wrapper已引入，还需要重复引入吗？ */

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

  .readonly-mode-time-range {
    :deep(.el-date-editor) {
      display: none;
    }
  }

</style>
<style lang="scss">
.hide-time-popper {
  display: none !important;
}
</style>
