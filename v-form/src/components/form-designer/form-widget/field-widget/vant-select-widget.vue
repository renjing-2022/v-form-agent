<template>
  <form-item-wrapper
      :designer="designer"
      :field="field"
      :rules="rules"
      :design-state="designState"
      :parent-widget="parentWidget"
      :parent-list="parentList"
      :index-of-parent-list="indexOfParentList"
      :sub-form-row-index="subFormRowIndex"
      :sub-form-col-index="subFormColIndex"
      :sub-form-row-id="subFormRowId"
  >
    <el-select
        ref="fieldEditor"
        class="full-width-input hide-popper"
        remote
        :key="selectKey"
        @focus="openPickerPopup"
        v-show="!isReadMode"
        v-model="fieldModel"
        :multiple="field.options.multiple"
        :collapse-tags="field.options.collapseTags"
        :teleported="false"
        :disabled="field.options.disabled"
        :clearable="field.options.clearable"
        :placeholder="
                field.options.placeholder ||
                i18nt('render.hint.selectPlaceholder')
            "
        @blur.capture="handleBlurCustomEvent"
        @change="handleChangeEvent"
    >
      <el-option
          popper-class="hide-popper"
          v-for="item in field.options.optionItems"
          :key="item.value"
          :label="item.label"
          :value="item.value"
          :disabled="item.disabled"
      >
      </el-option>
    </el-select>
    <Popup
        v-model:show="pickerConf.isShow"
        round
        position="bottom"
        class="select-popup"
    >
      <div class="pop-box" v-loading="pickerConf.loading">
        <div class="pop-header">
                    <span class="pop-title">{{
                        field.options.placeholder ||
                        i18nt("render.hint.select")
                      }}</span>
          <span
              class="van-picker__cancel fl"
              @click="pickerConf.isShow = false"
          >{{i18nt("render.hint.cancel")}}</span>
          <span
              class="van-picker__confirm fr"
              @click="onConfirmPicker"
          >{{i18nt("render.hint.confirm")}}</span>
        </div>
        <div class="pop-search" v-if="field.options.filterable">
          <Search
              shape="round"
              v-model="pickerConf.keyword"
              @search="getPickerOps"
          />
        </div>
        <div class="pop-body">
          <div class="pop-list-box">
            <div
                class="tab-item-li"
                v-for="(item, itemInx) of pickerConf.ops"
                :key="itemInx"
                @click="selectedPickerOp(item)"
            >
              {{ item.label }}
              <div class="tab-item-icon fr" v-if="item.isActive">
                <el-icon class="tab-item-icon-el"
                ><Select
                /></el-icon>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Popup>

    <template v-if="isReadMode">
      <span class="readonly-mode-field">{{ optionLabel }}</span>
    </template>
  </form-item-wrapper>
</template>

<script>
import FormItemWrapper from "./form-item-wrapper";
import emitter from "@/utils/emitter";
import i18n, {translate} from "@/utils/i18n";
import fieldMixin from "@/components/form-designer/form-widget/field-widget/fieldMixin";
import {generateId} from "@/utils/util";

/**
 * Vant
 */
import {Popup, Search} from "vant";

export default {
  name: "vant-select-widget",
  componentName: "FieldWidget", //必须固定为FieldWidget，用于接收父级组件的broadcast事件
  mixins: [emitter, fieldMixin, i18n],
  props: {
    field: Object,
    parentWidget: Object,
    parentList: Array,
    indexOfParentList: Number,
    designer: Object,

    designState: {
      type: Boolean,
      default: false,
    },

    subFormRowIndex: {
      /* 子表单组件行索引，从0开始计数 */ type: Number,
      default: -1,
    },
    subFormColIndex: {
      /* 子表单组件列索引，从0开始计数 */ type: Number,
      default: -1,
    },
    subFormRowId: {
      /* 子表单组件行Id，唯一id且不可变 */ type: String,
      default: "",
    },
  },
  components: {
    FormItemWrapper,
    Search,
    Popup,
  },
  data() {
    return {
      oldFieldValue: null, //field组件change之前的值
      fieldModel: null,
      rules: [],
      widgetKey: "",
      // 文本字段
      fieldLabel: "",
      // 下拉弹出层
      pickerConf: {
        // 是否显示
        isShow: false,
        // 搜索值
        keyword: "",
        // 加载状态
        loading: false,
        // 下拉数据
        ops: [],
        // 选中值 如果是单选就是字符串，如果是多选就是数组
        cutSelected: null,
      },
    };
  },
  computed: {
    allowDefaultFirstOption() {
      return (
          !!this.field.options.filterable || !!this.field.options.remote
      );
    },

    remoteMethod() {
      if (
          !!this.field.options.remote &&
          !!this.field.options.onRemoteQuery
      ) {
        return this.remoteQuery;
      } else {
        return undefined;
      }
    },

    selectKey() {
      return this.widgetKey || this.field.id;
    },
  },
  beforeCreate() {
    /* 这里不能访问方法和属性！！ */
  },

  created() {
    /* 注意：子组件mounted在父组件created之后、父组件mounted之前触发，故子组件mounted需要用到的prop
     需要在父组件created中初始化！！ */
    this.registerToRefList();
    this.initOptionItems();
    this.initFieldModel();
    this.initEventHandler();
    this.buildFieldRules();

    this.handleOnCreated();
  },

  mounted() {
    this.handleOnMounted();
  },

  beforeUnmount() {
    this.unregisterFromRefList();
  },

  methods: {
    /**
     * 获取选中项label
     * @return {*}
     */
    getSelectedLabel() {
      return this.$refs.fieldEditor.selectedLabel;
    },

    refreshWidgetKey() {
      //强制刷新组件！！
      this.widgetKey = "select-key-" + generateId();
    },

    /**
     * 下拉弹出层相关
     */
    // 打开下拉弹框
    openPickerPopup() {
      // 获取下拉数据
      this.initPickerOps();
      this.pickerConf.isShow = true;
      this.handleFocusCustomEvent();
    },

    // 获取下拉数据
    initPickerOps() {
      let {multiple} = this.field.options;
      this.pickerConf.ops = [];
      this.field.options.optionItems.forEach((el) => {
        el.isActive = false;
        // 是多选
        if (
            multiple &&
            this.fieldModel &&
            this.fieldModel.includes(el.value)
        ) {
          el.isActive = true;
        }
        // 非多选
        if (!multiple && el.value == this.fieldModel) {
          el.isActive = true;
        }

        this.pickerConf.ops.push(el);
      });
    },
    getPickerOps() {
      let {keyword} = this.pickerConf;
      this.pickerConf.ops = [];
      this.field.options.optionItems.forEach((el) => {
        if (el.label.indexOf(keyword) != -1) {
          this.pickerConf.ops.push(el);
        }
      });
    },
    // 清空下拉选中
    clearPickerOpsActive() {
      this.pickerConf.ops.forEach((el) => {
        el.isActive = false;
      });
    },
    // 下拉选项值选中
    selectedPickerOp(item) {
      let {multiple, multipleLimit} = this.field.options;
      // 多选
      if (multiple) {
        // 取选中数量
        let findActives = this.pickerConf.ops.filter(
            (el) => el.isActive
        );
        // 如果选中数量少于设定的值 可以切换选中
        if ((multipleLimit <= 0) || (findActives.length < multipleLimit)) {
          item.isActive = !item.isActive;
        }
        // 否则取消选中
        else {
          item.isActive = false;
        }
      }
      // 单选
      else {
        // 如果点击的是当前选中的
        if (item.value == this.pickerConf.cutSelected) {
          item.isActive = !item.isActive;
        } else {
          this.clearPickerOpsActive();
          item.isActive = true;
          this.pickerConf.cutSelected = item.value;
        }
      }
    },

    // 确认选中
    onConfirmPicker() {
      let {multiple} = this.field.options;
      // 取选中数量
      let findActives = this.pickerConf.ops.filter((el) => el.isActive);
      // 如果没有选中任何，直接关闭弹框
      if (findActives.length < 1) {
        this.pickerConf.isShow = false;
        this.fieldModel = multiple ? [] : "";
        return;
      }

      // 是否多选
      if (multiple) {
        this.fieldModel = findActives.map((el) => el.value);
      } else {
        this.fieldModel = findActives[0].value;
      }
      this.setValue(this.fieldModel)
      this.pickerConf.isShow = false;
    },
  },
};
</script>

<style lang="scss" scoped>
@import "../../../../styles/global.scss"; /* form-item-wrapper已引入，还需要重复引入吗？ */

.full-width-input {
  width: 100% !important;
}
</style>
