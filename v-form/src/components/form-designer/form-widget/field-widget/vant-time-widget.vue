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
    <div :class="[!!field.options.autoFullWidth ? 'auto-full-width' : '', isReadMode ? 'readonly-mode-time' : '']">
      <el-time-picker ref="fieldEditor"
                      popper-class="hide-time-popper"
                      v-model="fieldModel"
                      :disabled="field.options.disabled"
                      :readonly="field.options.readonly"
                      :clearable="field.options.clearable"
                      :editable="field.options.editable"
                      :format="field.options.format"
                      value-format="HH:mm:ss"
                      :placeholder="field.options.placeholder || i18nt('render.hint.timePlaceholder')"
                      @focus="handleTimeFocusEvent"
                      @blur="handleBlurCustomEvent"
                      @change="handleChangeEvent">
      </el-time-picker>
      <Popup
          v-model:show="popupShowFlag"
          round
          position="bottom"
          class="select-popup">
        <van-time-picker
            v-model="currentTime"
            :title="i18nt('render.hint.selectTime')"
            :columns-type="columnsType"
            :min-time="minTime"
            :max-time="maxTime"
            @cancel="onCancelTimePicker"
            @confirm="onConfirmTimePicker"
        />
      </Popup>
      <template v-if="isReadMode">
        <span class="readonly-mode-field">{{fieldModel}}</span>
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
import {Popup, TimePicker} from "vant";
import dayjs from "dayjs";

export default {
  name: "vant-time-widget",
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
    Popup,
    TimePicker,
  },
  data() {
    return {
      oldFieldValue: null, //field组件change之前的值
      fieldModel: null,
      rules: [],

      popupShowFlag: false,
      columnsType: ['hour', 'minute', 'second'],
      currentTime: ['09', '30', '00'],
      minTime: '00:00:00',
      maxTime: '23:59:59',
    }
  },
  computed: {

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

    handleTimeFocusEvent(event) {
      this.handleFocusCustomEvent(event)

      if (this.field.options.validateConfig?.startTime) {
        this.minTime = this.field.options.validateConfig.startTime
      }
      if (this.field.options.validateConfig?.endTime) {
        this.maxTime = this.field.options.validateConfig.endTime
      }

      if (this.fieldModel) {
        let timeParts = this.fieldModel.split(':')
        if (timeParts.length === 3) {
          this.currentTime = [timeParts[0], timeParts[1], timeParts[2]]
        }
      } else {
        let dsValue = dayjs()
        this.currentTime = [this.pad2Str(dsValue.hour()), this.pad2Str(dsValue.minute()), '00']
      }
      this.popupShowFlag = true
    },

    onCancelTimePicker(params) {
      this.popupShowFlag = false
    },

    onConfirmTimePicker(params) {
      if (this.currentTime && this.currentTime.length > 0) {
        this.fieldModel = this.currentTime.join(':')
        this.setValue(this.fieldModel)
      }

      this.popupShowFlag = false
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

.readonly-mode-time {
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