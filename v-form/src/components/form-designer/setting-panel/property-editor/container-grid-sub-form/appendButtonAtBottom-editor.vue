<template>
  <el-form-item :label="i18nt('designer.setting.appendButtonAtBottom')"
                :title="i18nt('designer.setting.appendButtonAtBottom')">
    <el-switch v-model="optionModel.appendButtonAtBottom"></el-switch>
  </el-form-item>
</template>

<script>
  import i18n from "@/utils/i18n"

  export default {
    name: "appendButtonAtBottom-editor",
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
