<script setup>
const homeRouteNames = new Set(['Home', 'Models'])

function routeViewKey(route) {
  return homeRouteNames.has(route.name) ? 'HomeView' : route.fullPath
}
</script>

<template>
  <router-view v-slot="{ Component, route }">
    <keep-alive include="HomeView">
      <component :is="Component" :key="routeViewKey(route)" />
    </keep-alive>
  </router-view>
</template>

<style>
</style>
