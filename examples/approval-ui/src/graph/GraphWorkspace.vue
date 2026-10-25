<script setup>
// Standalone adapter. Native hosts import the transport-free core directly.
import { api } from '../api.js'
import GraphWorkspaceCore from './GraphWorkspaceCore.vue'
defineOptions({ inheritAttrs: false })
const props=defineProps({actor:Object,locale:{type:String,default:'en'},mode:{type:String,default:'designer'},active:{type:Boolean,default:true},scenario:{type:String,default:'payment'},allowSubmit:{type:Boolean,default:true},allowDecide:{type:Boolean,default:true}})
</script>
<template><GraphWorkspaceCore v-bind="{...$attrs,...props}" :transport="api" /></template>
