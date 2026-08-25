<template>
  <div>
    <el-form-item label-width="0">
      <el-divider class="custom-divider">{{i18nt('designer.setting.columnSetting')}}</el-divider>
    </el-form-item>
    <el-form-item :label="i18nt('designer.setting.gutter')">
      <el-input-number v-model="optionModel.gutter" style="width: 100%"></el-input-number>
    </el-form-item>
    <el-form-item :label="i18nt('designer.setting.colsOfGrid')"></el-form-item>
    <el-form-item label-width="0">
      <draggable tag="div" :list="selectedWidget.cols" item-key="id"
                 v-bind="{group:'colsGroup', ghostClass: 'ghost', handle: '.drag-option'}">
        <template #item="{ element: colItem, index: colIdx }">
          <li :key="colIdx" class="col-item">
            <i class="iconfont icon-drag drag-option"></i>
            <span class="col-span-title">{{i18nt('designer.setting.colSpanTitle')}}{{colIdx + 1}}</span>
            <el-input-number v-model.number="colItem.options.span" :min="1" :max="24"
                             @change="(newValue, oldValue) => spanChanged(selectedWidget, colItem, colIdx, newValue, oldValue)"
                             class="cell-span-input"></el-input-number>
            <el-button circle plain size="small" type="danger" @click="deleteCol(selectedWidget, colIdx)"
                       icon="el-icon-minus" class="col-delete-button"></el-button>
            <el-button circle plain size="small" type="warning" @click="insertCol(selectedWidget, colIdx)"
                       icon="el-icon-plus"></el-button>
          </li>
        </template>
      </draggable>
      <div>
        <el-button link type="primary" @click="addNewCol(selectedWidget)">{{i18nt('designer.setting.addColumn')}}</el-button>
      </div>
    </el-form-item>
  </div>
</template>

<script>
  import i18n from "@/utils/i18n"

  export default {
    name: "gutter-editor",
    mixins: [i18n],
    props: {
      designer: Object,
      selectedWidget: Object,
      optionModel: Object,
    },
    methods: {
      spanChanged(curGrid) {
        let spanSum = 0
        curGrid.cols.forEach((colItem) => {
          spanSum += colItem.options.span
        })
        if (spanSum > 24) {
          //this.$message.info('列栅格之和超出24')
          console.log('列栅格之和超出24')
          //TODO: 语言字符串资源化
        }

        this.designer.saveCurrentHistoryStep()
      },

      deleteCol(curGrid, colIdx) {
        this.designer.deleteColOfGrid(curGrid, colIdx)
        this.designer.emitHistoryChange()
      },

      insertCol(curGrid, colIdx) {
        this.designer.insertNewColOfGrid(curGrid, colIdx)
        this.designer.emitHistoryChange()
      },

      addNewCol(curGrid) {
        this.designer.addNewColOfGrid(curGrid)
        this.designer.emitHistoryChange()
      },

    }
  }
</script>

<style lang="scss" scoped>
  li.col-item {
    list-style: none;

    span.col-span-title {
      display: inline-block;
      font-size: 13px;
      width: 90px;
      line-height: 16px;
      height: 16px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }

    .drag-option {
      cursor: move;
    }

    .cell-span-input {
      width: 90px;
    }

    .col-delete-button {
      margin-left: 6px;
    }
  }

</style>
