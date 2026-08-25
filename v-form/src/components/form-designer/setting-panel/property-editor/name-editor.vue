<template>
  <el-form-item prop="name" :rules="nameRequiredRule">
    <template #label>
      <span v-if="widgetNameReadonly" :data-clipboard-text="optionModel.name" @click.stop="copyWidgetName">
        {{i18nt('designer.setting.uniqueName')}}
        <el-tooltip effect="light" :content="i18nt('designer.setting.editNameHelp')">
          <svg-icon icon-class="el-info" /></el-tooltip>
      </span>
      <span v-else>
        {{i18nt('designer.setting.uniqueName')}}
        <el-tooltip effect="light" :content="i18nt('designer.setting.editNameHelp')">
          <svg-icon icon-class="el-info" /></el-tooltip>
      </span>
    </template>
    <template v-if="!!selectedWidget.category || noFieldList">
      <el-input type="text" v-model="optionModel.name" :readonly="widgetNameReadonly" @change="updateWidgetNameAndRef"></el-input>
    </template>
    <template v-else>
      <el-select v-model="optionModel.name" allow-create filterable :disabled="widgetNameReadonly" @change="updateWidgetNameAndRef"
                 :title="i18nt('designer.setting.editNameHelp')">
        <el-option v-for="(sf, sfIdx) in getNameFieldList()" :key="sfIdx" :label="sf.label" :value="sf.name"></el-option>
      </el-select>
    </template>
  </el-form-item>
</template>

<script>
  import SvgIcon from '@/components/svg-icon'
  import i18n from "@/utils/i18n"
  import {copyToClipboard, isEmptyStr} from "@/utils/util"

  export default {
    name: "name-editor",
    mixins: [i18n],
    components: {
      SvgIcon
    },
    props: {
      designer: Object,
      selectedWidget: Object,
      optionModel: Object,
    },
    inject: ['getServerFieldList', 'getDesignerConfig'],
    data() {
      return {
        nameRequiredRule: [{required: true, message: 'name required'}],
        curNameFieldList: [],
      }
    },
    computed: {
      serverFieldList() {
        return this.getServerFieldList()
      },

      noFieldList() {
        return !this.serverFieldList || (this.serverFieldList.length <= 0)
      },

      widgetNameReadonly() {
        return !!this.getDesignerConfig().widgetNameReadonly || !!this.selectedWidget.nameReadonly
      },

    },
    methods: {
      copyWidgetName(e) {
        const wName = this.selectedWidget.options.name
        copyToClipboard(wName, e,
            this.$message,
            this.i18nt('designer.hint.copyWidgetNameSuccess') + ': ' + wName,
            this.i18nt('designer.hint.copyWidgetNameFail')
        )
      },

      updateWidgetNameAndRef(newName) {
        let oldName = this.designer.selectedWidgetName
        if (isEmptyStr(newName)) {
          this.selectedWidget.options.name = oldName
          this.$message.info(this.i18nt('designer.hint.nameRequired'))
          return
        }

        if (!!this.designer.formWidget) {
          const widgetId = this.designer.selectedId
          let foundRef = this.designer.formWidget.getWidgetRefById(widgetId, newName) // 检查newName是否已存在！！
          if (!!foundRef) {
            this.selectedWidget.options.name = oldName
            this.$message.info(this.i18nt('designer.hint.duplicateName') + newName)
            return
          }

          let widgetInDesign = this.designer.formWidget.getWidgetRefById(widgetId, oldName)
          if (!!widgetInDesign && !!widgetInDesign.registerToRefList) {
            widgetInDesign.registerToRefList(oldName)  //注册组件新的ref名称并删除老的ref！！
            let newLabel = this.getLabelByFieldName(newName)
            this.designer.updateSelectedWidgetNameAndLabel(this.selectedWidget, newName, newLabel)
          }
        }
      },

      getLabelByFieldName(fieldName) {
        for (let i = 0; i < this.curNameFieldList.length; i++) {
          if (this.curNameFieldList[i].name === fieldName) {
            let widgetLabel = this.curNameFieldList[i].label
            //处理从表实体的字段label前缀！！
            if (widgetLabel && (widgetLabel.indexOf('.') > -1)) {
              widgetLabel = widgetLabel.substring(widgetLabel.indexOf('.') + 1)
            }

            return widgetLabel
          }
        }

        return null
      },

      getNameFieldList() {
        const widgetId = this.designer.selectedId
        const widgetName = this.designer.selectedWidgetName
        let foundRef = this.designer.formWidget.getWidgetRefById(widgetId, widgetName)
        if (foundRef && foundRef.widget) {  //容器类组件
          this.curNameFieldList = this.getServerFieldList()
          return this.curNameFieldList
        }

        if (foundRef && foundRef.field) {
          let nameFieldList = []
          let sfName = foundRef.field.subFormName || foundRef.subFormName
          this.getServerFieldList().forEach(fld => {
            if (sfName) {
              if (fld.detailEntity === sfName) {
                nameFieldList.push(fld)
              }
            } else {
              if (!fld.detailEntity) {
                nameFieldList.push(fld)
              }
            }
          })

          this.curNameFieldList = nameFieldList
          return nameFieldList
        } else {
          this.curNameFieldList = this.getServerFieldList()
          return this.curNameFieldList
        }
      }

    }
  }
</script>

<style lang="scss" scoped>

</style>
