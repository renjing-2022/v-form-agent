<template>
  <el-form-item :label="i18nt('designer.setting.required')">
    <el-switch v-model="optionModel.required" @change="handleChangeEvent"></el-switch>
  </el-form-item>
</template>

<script>
  import i18n from "@/utils/i18n"

  export default {
    name: "required-editor",
    mixins: [i18n],
    props: {
      designer: Object,
      selectedWidget: Object,
      optionModel: Object,
    },
    methods: {
      handleChangeEvent(val) {
        const wId = this.designer.selectedId
        const wName = this.designer.selectedWidgetName
        const wRef = this.designer.formWidget.getWidgetRefById(wId, wName)
        if (wRef && wRef.setRequired) {
          wRef.setRequired(val)
        }
      },

    }
  }
</script>

<style scoped>

</style>
