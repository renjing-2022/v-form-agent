import { createApp } from 'vue'
import axios from 'axios'
import App from './App.vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '@/styles/index.scss'
import '@/iconfont/iconfont.css'
import "vant/lib/index.css";
import Draggable from '@/../lib/vuedraggable/dist/vuedraggable.umd.js'
import {registerIcon} from '@/utils/el-icons'
import 'virtual:svg-icons-register'

import ContainerWidgets from '@/components/form-designer/form-widget/container-widget/index'
import ContainerItems from '@/components/form-render/container-item/index'
import VFormRender from '@/components/form-render/index'
import TableMultiLevelColumn from '@/components/form-designer/form-widget/table-multi-level-column'
import TableHighLevelColumn from '@/components/form-render/table-high-level-column'

import { addDirective } from '@/utils/directive'
import { loadExtension } from '@/extension/extension-loader'

import {Popup, Picker, PickerGroup, DatePicker, TimePicker, Cascader, Checkbox} from 'vant'

if (typeof window !== 'undefined') {
  window.axios = axios
}

const vfApp = createApp(App)

vfApp.config.performance = true
vfApp.use(ElementPlus)
vfApp.use(Popup)
vfApp.use(Picker)
vfApp.use(PickerGroup)
vfApp.use(DatePicker)
vfApp.use(TimePicker)
vfApp.use(Cascader)
vfApp.use(Checkbox)
registerIcon(vfApp)
vfApp.component('draggable', Draggable)
addDirective(vfApp)

vfApp.use(ContainerWidgets)
vfApp.use(ContainerItems)
vfApp.component('VFormRender', VFormRender)
vfApp.component(TableMultiLevelColumn.name, TableMultiLevelColumn)
vfApp.component(TableHighLevelColumn.name, TableHighLevelColumn)
loadExtension(vfApp)

vfApp.mount('#app')
