function ensureValueRef(owner, key, fallback) {
  const existing = owner?.[key]
  if (existing && typeof existing === 'object' && 'value' in existing) {
    return existing
  }
  const placeholder = { value: fallback }
  if (owner) owner[key] = placeholder
  return placeholder
}

function ensureFn(owner, key, fallback = () => {}) {
  if (typeof owner?.[key] === 'function') return owner[key]
  if (owner) owner[key] = fallback
  return fallback
}

export function normalizeAutoTriggerDeps(vizStore, timeline, layers) {
  const generatedVizLayersRef = ensureValueRef(layers, 'generatedVizLayers', [])

  ensureFn(layers, 'removeGeneratedLayer')
  ensureFn(layers, 'registerGeneratedLayer')
  ensureFn(layers, 'buildGeneratedLayerId', () => '')
  ensureFn(layers, 'buildGeneratedLayerLabel', () => '')
  ensureFn(layers, 'vizLayerIdForUE', () => '')
  ensureFn(layers, 'sendVizLayerVisibilityToUE')

  return {
    generatedVizLayersRef,
    previewImageUrlRef: ensureValueRef(vizStore, 'previewImageUrl', ''),
    previewVMinRef: ensureValueRef(vizStore, 'previewVMin', 0),
    previewVMaxRef: ensureValueRef(vizStore, 'previewVMax', 0),
    previewRowsRef: ensureValueRef(vizStore, 'previewRows', 0),
    previewColsRef: ensureValueRef(vizStore, 'previewCols', 0),
    previewFrameCountRef: ensureValueRef(vizStore, 'previewFrameCount', 0),
    previewPhysicalWidthRef: ensureValueRef(
      vizStore,
      'previewPhysicalWidth',
      0,
    ),
    previewPhysicalHeightRef: ensureValueRef(
      vizStore,
      'previewPhysicalHeight',
      0,
    ),
    previewGeometricCenterRef: ensureValueRef(
      vizStore,
      'previewGeometricCenter',
      null,
    ),
    selectedLayerIdRef: ensureValueRef(vizStore, 'selectedLayerId', null),
    batchLoadedImagesRef: ensureValueRef(vizStore, 'batchLoadedImages', []),
    isBatchLoadingRef: ensureValueRef(vizStore, 'isBatchLoading', false),
    batchLoadingTextRef: ensureValueRef(vizStore, 'batchLoadingText', ''),
    batchLoadProgressRef: ensureValueRef(vizStore, 'batchLoadProgress', 0),
    batchLoadCurrentRef: ensureValueRef(vizStore, 'batchLoadCurrent', 0),
    batchLoadTotalRef: ensureValueRef(vizStore, 'batchLoadTotal', 0),
    timelineCurrentStepRef: ensureValueRef(timeline, 'timelineCurrentStep', 0),
    timelineTotalStepsRef: ensureValueRef(timeline, 'timelineTotalSteps', 0),
    timelinePhysicalTimesRef: ensureValueRef(
      timeline,
      'timelinePhysicalTimes',
      [],
    ),
    timelineTimeStepsRef: ensureValueRef(timeline, 'timelineTimeSteps', []),
    hasAppliedSettingsRef: ensureValueRef(
      timeline,
      'hasAppliedSettings',
      false,
    ),
    isTimelineCollapsedRef: ensureValueRef(
      timeline,
      'isTimelineCollapsed',
      true,
    ),
  }
}
