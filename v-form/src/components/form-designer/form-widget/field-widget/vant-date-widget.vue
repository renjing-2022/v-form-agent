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
    <div :class="[!!field.options.autoFullWidth ? 'auto-full-width' : '', isReadMode ? 'readonly-mode-date' : '']">
      <el-date-picker ref="fieldEditor"
                      :type="field.options.type"
                      v-model="fieldModel"
                      popper-class="hide-date-popper"
                      :class="[!!field.options.autoFullWidth ? 'auto-full-width' : '']"
                      :readonly="field.options.readonly"
                      :disabled="field.options.disabled"
                      :clearable="field.options.clearable"
                      :editable="field.options.editable"
                      :format="field.options.format"
                      :value-format="field.options.valueFormat"
                      :placeholder="field.options.placeholder || i18nt('render.hint.datePlaceholder')"
                      @focus="handleDateFocusEvent"
                      @blur="handleBlurCustomEvent"
                      @change="handleChangeEvent"
      >
      </el-date-picker>
      <Popup
          v-model:show="popupShowFlag"
          round
          position="bottom"
          class="select-popup">
        <van-picker-group
            :title="i18nt('render.hint.selectDate')"
            :tabs="pickerTabs"
            :next-step-text="i18nt('render.hint.nextStep')"
            @cancel="onCancelDatePicker"
            @confirm="onConfirmDatePicker">
          <van-date-picker
              v-model="currentDate"
              :min-date="minDate"
              :max-date="maxDate"
          />
          <van-time-picker
              v-if="field.options.type === 'datetime'"
              v-model="currentTime"
              :columns-type="columnsType"
          />
        </van-picker-group>
      </Popup>
      <template v-if="isReadMode">
        <span class="readonly-mode-field">{{ fieldModel }}</span>
      </template>
    </div>
  </form-item-wrapper>
</template>


<script>
import FormItemWrapper from './form-item-wrapper'
import emitter from '@/utils/emitter'
import i18n, {translate} from "@/utils/i18n";
import fieldMixin from "@/components/form-designer/form-widget/field-widget/fieldMixin";
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

/**
 * Vant
 */
import {Popup, PickerGroup, DatePicker, TimePicker} from "vant";

dayjs.extend(customParseFormat)

export default {
  name: "vant-date-widget",
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
    FormItemWrapper, Popup, PickerGroup, DatePicker, TimePicker,
  },
  data() {
    return {
      oldFieldValue: null, //field组件change之前的值
      fieldModel: null,
      rules: [],

      popupShowFlag: false,
      currentDate: ['2024', '01', '01'],
      minDate: new Date(1800, 0, 1),
      maxDate: new Date(2500, 11, 31),
      currentTime: ['09', '30', '00'],
      columnsType: ['hour', 'minute', 'second'],
    }
  },
  computed: {
    isDateTime() {
      return this.field.options.type === 'datetime'
    },

    pickerTabs() {
      if (this.field.options.type === 'datetime') {
        return [this.i18nt('render.hint.selectDate'), this.i18nt('render.hint.selectTime')]
      } else {
        return [this.i18nt('render.hint.selectTime')]
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
    pad2Str(intValue) {
      return (intValue + '').padStart(2, '0')
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

      if (this.fieldModel) {
        let dateValue = dayjs(this.fieldModel, this.field.options.valueFormat)
        this.currentDate = [
            dateValue.year(),
            this.pad2Str(dateValue.month() + 1),
            this.pad2Str(dateValue.date())
        ]

        if (this.isDateTime) {
          let dtArray = this.fieldModel.split(' ')
          if (dtArray.length === 2) {
            let timeParts = dtArray[1].split(':')
            if (timeParts.length === 3) {
              this.currentTime = [timeParts[0], timeParts[1], timeParts[2]]
            }
          }
        }
      } else {
        let dateValue = dayjs()
        this.currentDate = [
          dateValue.year(),
          this.pad2Str(dateValue.month() + 1),
          this.pad2Str(dateValue.date())
        ]

        if (this.isDateTime) {
          this.currentTime = [this.pad2Str(dateValue.hour()), this.pad2Str(dateValue.minute()), '00']
        }
      }
      this.popupShowFlag = true
    },

    onCancelDatePicker(params) {
      this.popupShowFlag = false
    },

    onConfirmDatePicker(params) {
      if (this.currentDate && this.currentDate.length > 0) {
        this.fieldModel = this.currentDate.join('-')
        if (!this.isDateTime) {
          this.setValue(this.fieldModel)
        } else {
          if (this.currentTime && this.currentTime.length > 0) {
            this.fieldModel += ' ' + this.currentTime.join(':')
          } else {
            this.fieldModel += ' 09:30:00'
          }
          this.setValue(this.fieldModel)
        }
      }

      this.popupShowFlag = false  //此行必须放在最后！！
    }

  }
}
</script>

<style lang="scss" scoped>
@import "../../../../styles/global.scss"; /* form-item-wrapper已引入，还需要重复引入吗？ */

.auto-full-width {
  width: 100%;

  :deep(.el-date-editor) {
    width: 100% !important;
  }
}

.readonly-mode-date {
  :deep(.el-date-editor) {
    display: none;
  }
}

</style>
<style lang="scss">
.hide-date-popper {
  display: none !important;
}
</style>