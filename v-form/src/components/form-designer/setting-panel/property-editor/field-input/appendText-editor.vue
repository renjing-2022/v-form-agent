<template>
  <div>
    <el-form-item :label="i18nt('designer.setting.appendText')">
      <el-switch v-model="optionModel.appendText"></el-switch>
    </el-form-item>
  </div>
</template>

<script>
  import i18n from "@/utils/i18n"

  export default {
    name: "appendText-editor",
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
