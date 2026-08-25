<!--
/**
 * author: vformAdmin
 * email: vdpadmin@163.com
 * website: https://www.vform666.com
 * date: 2021.08.18
 * remark: 如果要分发VForm源码，需在本文件顶部保留此文件头信息！！
 */
-->

<template>
  <container-wrapper :designer="designer" :widget="widget" :parent-widget="parentWidget" :parent-list="parentList"
                     :index-of-parent-list="indexOfParentList">

    <div class="sub-form-container" :key="curSubFormKey"
         :class="{'selected': selected}" @click.stop="selectWidget(widget)">
      <el-form label-position="top">
        <div class="sub-form-table">
          <draggable :list="widget.widgetList" item-key="id" v-bind="{group:'dragGroup', ghostClass: 'ghost',animation: 400}"
                     tag="div" :component-data="{name: 'fade', class: 'sub-form-drag-drop-zone'}"
                     handle=".drag-handler"
                     @add="(evt) => onSubFormDragAdd(evt, widget.widgetList)"
                     @end="onSubFormDragEnd"
                     @update="onContainerDragUpdate" :move="checkContainerMove">
            <template #item="{ element: subWidget, index: swIdx }">
              <div class="sub-form-table-column" :style="{width: subWidget.options.columnWidth}">
                <component :is="subWidget.type + '-widget'" :field="subWidget" :designer="designer" :key="subWidget.id"
                              :parent-list="widget.widgetList" :index-of-parent-list="swIdx" :parent-widget="widget"
                              :design-state="true"></component>
              </div>
            </template>
          </draggable>
        </div>
      </el-form>
    </div>

  </container-wrapper>
</template>

<script>
  import i18n from "@/utils/i18n"
  import containerMixin from "@/components/form-designer/form-widget/container-widget/containerMixin"
  import ContainerWrapper from "@/components/form-designer/form-widget/container-widget/container-wrapper"
  import FieldComponents from '@/components/form-designer/form-widget/field-widget/index'
  import refMixinDesign from "@/components/form-designer/refMixinDesign"
  import {generateId} from "@/utils/util";

  export default {
    name: "sub-form-widget",
    componentName: 'ContainerWidget',
    mixins: [i18n, containerMixin, refMixinDesign],
    inject: ['refList'],
    components: {
      ContainerWrapper,
      ...FieldComponents,
    },
    props: {
      widget: Object,
      parentWidget: Object,
      parentList: Array,
      indexOfParentList: Number,
      designer: Object,
    },
    provide() {
      return {
        getSubFormFieldFlag: () => true,
        getSubFormName: () => this.widget.options.name,
      }
    },
    data() {
      return {
        subFormKey: 'sfKey' + this.widget.id,
      }
    },
    computed: {
      selected() {
        return this.widget.id === this.designer.selectedId
      },

      customClass() {
        return this.widget.options.customClass || ''
      },

      curSubFormKey() {
        return this.subFormKey
      },

    },
    watch: {
      //
    },
    created() {
      this.initRefList()
    },
    mounted() {
      //
    },
    methods: {

      onSubFormDragAdd(evt, subList) {
        const newIndex = evt.newIndex
        if (!!subList[newIndex]) {
          this.designer.setSelected( subList[newIndex] )
        }

        this.designer.emitHistoryChange()
        console.log('test', 'onSubFormDragAdd')
        this.designer.emitEvent('field-selected', this.widget)
      },

      onSubFormDragEnd(evt) {
        console.log('sub form drag end: ', evt)
      },

      /* 强制刷新，重新生成整个子表单组件！！！ */
      forceUpdate() {
        this.subFormKey = 'sfKey' + generateId()
      },

    }
  }
</script>

<style lang="scss" scoped>
  .sub-form-container {
    padding: 8px;
    border: 1px dashed #336699;
    overflow-x: auto; //配合max-content属性，超出自动显示水平滚动条

    :deep(.sub-form-table) {
      min-height: 68px;
      min-width: max-content;

      .sub-form-drag-drop-zone {
        min-height: 68px;
      }

      div.sub-form-table-column {
        display: inline-block;
      }
    }

    :deep(.ghost) {
      content: '';
      font-size: 0;
      //height: 3px;
      height: 74px;
      width: 1px;
      box-sizing: border-box;
      display: inline-block;
      background: $--color-primary;
      border: 2px solid $--color-primary;
      outline-width: 0;
      padding: 0;
      margin: 0;
      overflow: hidden;
    }
  }

  .sub-form-container.selected {
    outline: 2px solid $--color-primary !important;
  }

</style>
