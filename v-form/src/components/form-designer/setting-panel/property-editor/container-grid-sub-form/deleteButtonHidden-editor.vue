<template>
  <el-form-item :label="i18nt('designer.setting.deleteButtonHidden')"
                :title="i18nt('designer.setting.deleteButtonHidden')">
    <el-switch v-model="optionModel.deleteButtonHidden"></el-switch>
  </el-form-item>
</template>

<script>
  import i18n from "@/utils/i18n"

  export default {
    name: "deleteButtonHidden-editor",
    mixins: [i18n],
    props: {
      designer: Object,
      selectedWidget: Object,
      optionModel: Object,
    },
  }
</script>

<style scoped>

</style>
