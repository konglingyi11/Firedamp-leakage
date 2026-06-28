import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../ThreeVisualizationCanvas.vue', import.meta.url),
  'utf8',
)
const visualizationStateSource = readFileSync(
  new URL('../../composables/useVisualizationState.js', import.meta.url),
  'utf8',
)
const homeViewSource = readFileSync(
  new URL('../../views/HomeView.vue', import.meta.url),
  'utf8',
)

const geometryConfigMatch = source.match(
  /key:\s*'geometry'[\s\S]*?url:\s*'\/未细化\.glb'[\s\S]*?\n\s*}/,
)

assert.ok(geometryConfigMatch, 'finds the unrefined geometry GLB config')

const geometryConfig = geometryConfigMatch[0]

assert.match(
  geometryConfig,
  /rotation:\s*\[Math\.PI\s*\/\s*2,\s*0,\s*0\]/,
  'rotates the new geometry GLB around X by 90 degrees',
)
assert.match(
  geometryConfig,
  /scaleToBounds:\s*false/,
  'keeps geometry GLB at its configured size instead of fitting task bounds',
)
assert.match(
  source,
  /function alignModelBottomToTargetBounds\(model, targetBounds\)[\s\S]*?targetBounds\.min\?\.\[2\][\s\S]*?new THREE\.Box3\(\)\.setFromObject\(model\)[\s\S]*?isMeetingRoomTask\(\)[\s\S]*?targetCenter\.x - modelCenter\.x[\s\S]*?targetCenter\.y - modelCenter\.y[\s\S]*?model\.position\.add\(delta\)/,
  'aligns loaded meeting-room GLB model centers and bottoms to the task bounding box',
)
assert.match(
  geometryConfig,
  /matchAxes:\s*true/,
  'matches geometry scale per axis like the real model',
)
assert.match(
  geometryConfig,
  /scaleAxisMap:\s*\[0,\s*2,\s*1\]/,
  'uses the same Y/Z scale axis swap as the real model',
)
assert.match(
  geometryConfig,
  /scaleMultiplier:\s*\[0\.7,\s*0\.8,\s*0\.7\]/,
  'uses the same scale multiplier as the real model',
)
assert.match(
  geometryConfig,
  /alignAnchor:\s*'min'/,
  'uses the same min anchor as the real model',
)
assert.match(
  geometryConfig,
  /positionOffset:\s*\[1\.5,\s*1\.5,\s*0\]/,
  'uses the same position offset as the real model',
)
assert.match(
  source,
  /const LOCAL_MEETING_ROOM_GEOMETRY_MODEL_URL = '\/huiyishi\(1\)\.glb'/,
  'uses the local meeting-room GLB for the geometry model layer',
)
assert.match(
  source.match(/function resolveGeometryModelUrl\(\)[\s\S]*?function resolveRealModelUrl\(\)/)?.[0] || '',
  /resolveLocalGeometryModelUrlForTask\(task\),/,
  'checks the local meeting-room geometry GLB before API-provided geometry fields',
)
assert.match(
  source,
  /const MEETING_ROOM_SPLAT_URL = '\/splat\/%E9%AB%98%E6%96%AF%E6%B3%BC%E6%BA%85\.splat'/,
  'uses the tuned test-splat asset as the meeting-room real model',
)
assert.match(
  source,
  /const MEETING_ROOM_STANDING_IDLE_MODEL_URL = '\/person\.glb'/,
  'uses the local person GLB for the meeting-room human body marker',
)
assert.match(
  source,
  /const MEETING_ROOM_HUMAN_MODEL_MAX_HEIGHT = 0\.3/,
  'keeps the meeting-room person model small enough to act as a position marker',
)
assert.match(
  source,
  /const MEETING_ROOM_STANDING_IDLE_TARGET_POSITION_CM = new THREE\.Vector3\(650,\s*-280,\s*20\)[\s\S]*?MEETING_ROOM_STANDING_IDLE_TARGET_POSITION_CM\.clone\(\)\.multiplyScalar\(0\.01\)/,
  'places the meeting-room person model at the requested 650/-280/20 centimeter coordinate',
)
assert.match(
  source,
  /const MEETING_ROOM_HUMANBODY_SELECTION_NAME = 'human_release_source_1'/,
  'targets the human release source geometry selection for meeting-room human placement',
)
assert.match(
  source,
  /const MEETING_ROOM_STANDING_IDLE_UP_AXIS = 'z'/,
  'uses world Z as the meeting-room standing model up axis',
)
assert.match(
  source,
  /const MEETING_ROOM_SURFACE_ROTATION_X = 0[\s\S]*?const MEETING_ROOM_GEOMETRY_FLIP_ROTATION_Z = Math\.PI[\s\S]*?const MEETING_ROOM_OVERALL_ROTATION_Z = Math\.PI[\s\S]*?const MEETING_ROOM_FLOOR_ROTATION_Z = 0[\s\S]*?meetingRoomRotation:\s*\[[\s\S]*?MEETING_ROOM_SURFACE_ROTATION_X,[\s\S]*?0,[\s\S]*?MEETING_ROOM_GEOMETRY_FLIP_ROTATION_Z \+ MEETING_ROOM_OVERALL_ROTATION_Z \+ MEETING_ROOM_FLOOR_ROTATION_Z[\s\S]*?\]/,
  'applies the shared meeting-room surface rotation and horizontal X-direction flip to the geometry model',
)
assert.match(
  source,
  /const MEETING_ROOM_SPLAT_EXTRA_ROTATION_Z = Math\.PI[\s\S]*?const MEETING_ROOM_SPLAT_OBJECT_TRANSFORM = \{[\s\S]*?rotationX:\s*-Math\.PI\s*\/\s*2 \+ MEETING_ROOM_SURFACE_ROTATION_X[\s\S]*?rotationZ:[\s\S]*?MEETING_ROOM_GEOMETRY_FLIP_ROTATION_Z \+[\s\S]*?MEETING_ROOM_OVERALL_ROTATION_Z \+[\s\S]*?MEETING_ROOM_FLOOR_ROTATION_Z \+[\s\S]*?MEETING_ROOM_SPLAT_EXTRA_ROTATION_Z[\s\S]*?rotationOrder:\s*'ZXY'/,
  'applies the meeting-room 3DGS horizontal flip as a world-Z yaw before the X-axis base rotation',
)
assert.match(
  source,
  /function applyMeetingRoomSplatObjectTransform\(object = meetingRoomSplatObject\)[\s\S]*?object\.rotation\.set\([\s\S]*?MEETING_ROOM_SPLAT_OBJECT_TRANSFORM\.rotationZ,[\s\S]*?MEETING_ROOM_SPLAT_OBJECT_TRANSFORM\.rotationOrder[\s\S]*?object\.viewer\?\.splatMesh\?\.updateTransforms\?\.\(\)/,
  'applies the meeting-room 3DGS rotation order to the rendered splat object and refreshes internal transforms',
)
assert.match(
  source,
  /function disableMeetingRoomSplatFrustumCulling\(object = meetingRoomSplatObject\)[\s\S]*?object\.frustumCulled = false[\s\S]*?child\.frustumCulled = false[\s\S]*?object\.viewer\.splatMesh\.frustumCulled = false/,
  'disables frustum culling for the transformed meeting-room 3DGS object and internal splat mesh',
)
assert.match(
  source,
  /function applyMeetingRoomSplatObjectTransform\(object = meetingRoomSplatObject\)[\s\S]*?disableMeetingRoomSplatFrustumCulling\(object\)[\s\S]*?object\.rotation\.set/,
  'keeps frustum culling disabled whenever the meeting-room 3DGS transform is reapplied',
)
assert.match(
  source,
  /function getMeetingRoomSplatDisplaySize\(box\) \{[\s\S]*?return box\.getSize\(new THREE\.Vector3\(\)\)/,
  'uses the 3DGS clip-box size directly without swapping the Z-up axes',
)
assert.match(
  source,
  /key:\s*'meetingRoomStandingIdle'[\s\S]*?layerKind:\s*'realModel'[\s\S]*?url:\s*MEETING_ROOM_STANDING_IDLE_MODEL_URL[\s\S]*?meetingRoomOnly:\s*true[\s\S]*?loadWithoutBounds:\s*true[\s\S]*?rotation:\s*\[Math\.PI\s*\/\s*2,\s*Math\.PI,\s*0\][\s\S]*?animationFrameTime:\s*0/,
  'loads the meeting-room standing model without waiting for task bounds, remaps its up axis, and samples the first animation frame',
)
assert.match(
  source,
  /key:\s*'meetingRoomStandingIdle'[\s\S]*?showWithModelLayer:\s*true/,
  'keeps the meeting-room person model visible with the model layer without overriding its material color',
)
assert.match(
  source,
  /function applyHighlightModelMaterial\(model, config\)[\s\S]*?MeshBasicMaterial\(\{[\s\S]*?depthTest:\s*false[\s\S]*?side:\s*THREE\.DoubleSide/,
  'renders highlighted helper models through surrounding geometry',
)
assert.match(
  source,
  /function canLoadGLTFModelConfig\(config\)[\s\S]*?config\.meetingRoomOnly && !isMeetingRoomTask\(\)[\s\S]*?return false/,
  'prevents meeting-room-only helper models from loading on other tasks',
)
assert.match(
  source,
  /function canLoadGLTFModelConfig\(config\)[\s\S]*?config\.loadWithoutBounds && resolveGLTFModelUrl\(config\)[\s\S]*?return true/,
  'allows the meeting-room standing model to load before geometry bounds are available',
)
assert.match(
  source,
  /function findMeetingRoomHumanBodyObject\(geometryModel\)[\s\S]*?MEETING_ROOM_HUMANBODY_SELECTION_NAME[\s\S]*?geometrySelectionName[\s\S]*?includes\(targetToken\)/,
  'finds the humanbody object from the geometry model selection names',
)
assert.match(
  source,
  /function loadMeetingRoomHumanBodyBoxFromGeometryGlb\(\)[\s\S]*?LOCAL_MEETING_ROOM_GEOMETRY_MODEL_URL[\s\S]*?findMeetingRoomHumanBodyObject\(model\)[\s\S]*?meetingRoomHumanBodyCachedBox/,
  'preloads the humanbody box from the meeting-room geometry GLB when the geometry layer is not loaded',
)
assert.match(
  source,
  /function alignMeetingRoomStandingIdleModelToHumanBody\(\)[\s\S]*?getMeetingRoomHumanBodyBoxFromScene\(\)[\s\S]*?loadMeetingRoomHumanBodyBoxFromGeometryGlb\(\)[\s\S]*?alignMeetingRoomStandingIdleModelToBox\(loadedBox\)/,
  'aligns the standing model from the visible scene box or the cached geometry GLB box',
)
assert.match(
  source,
  /function alignMeetingRoomStandingIdleModelToBox\(targetBox\)[\s\S]*?gltfModels\.get\('meetingRoomStandingIdle'\)[\s\S]*?const upAxis = MEETING_ROOM_STANDING_IDLE_UP_AXIS[\s\S]*?limitedTargetHeight \/ standingHeight[\s\S]*?const targetPosition = MEETING_ROOM_STANDING_IDLE_TARGET_POSITION[\s\S]*?delta\[upAxis\] = targetPosition\[upAxis\] - alignedBox\.min\[upAxis\]/,
  'scales the standing model from the humanbody bounds and places its feet at the configured meeting-room coordinate',
)
assert.match(
  source,
  /function keepMeetingRoomStandingIdleInsideSplat\(model\)[\s\S]*?getMeetingRoomSplatWorldClipBox\(\)[\s\S]*?return splatBox/,
  'does not force the meeting-room standing model into the 3DGS clip box after placement',
)
assert.doesNotMatch(
  source.match(/function keepMeetingRoomStandingIdleInsideSplat\(model\)[\s\S]*?function alignMeetingRoomStandingIdleModelToBox/)?.[0] || '',
  /moveModelBoxInsideContainer/,
  'leaves the standing model at the aligned humanbody coordinate instead of pushing it inside 3DGS',
)
assert.match(
  source,
  /function updateMeetingRoomSplatDebugGroup\(\)[\s\S]*?getMeetingRoomSplatWorldClipBox\(\)[\s\S]*?MeetingRoomSplatDebugBox[\s\S]*?createMeetingRoomDebugBox\(splatBox, 0x40ff6a\)/,
  'renders a visible debug box for the meeting-room 3DGS world bounds',
)
assert.match(
  source,
  /alignMeetingRoomSplatRightFaceToGeometry\(\)[\s\S]*?updateMeetingRoomSplatDebugGroup\(\)[\s\S]*?alignMeetingRoomStandingIdleModelToHumanBody\(\)/,
  'realigns the standing model after the meeting-room splat is loaded and aligned',
)
assert.match(
  source,
  /function alignMeetingRoomSplatRightFaceToGeometry\(\)[\s\S]*?buildTaskModelTargetBounds\(\)[\s\S]*?new THREE\.Box3\([\s\S]*?new THREE\.Vector3\(\.\.\.taskTargetBounds\.min\)[\s\S]*?targetCenter\.x - splatCenter\.x[\s\S]*?targetCenter\.y - splatCenter\.y[\s\S]*?targetBox\.min\.z - splatBox\.min\.z/,
  'aligns the 3DGS XOY bottom plane and XY center to the task bounding box',
)
assert.match(
  source,
  /function scaleModelToBounds\(\)[\s\S]*?alignModelBottomToTargetBounds\(geometryModel, taskTargetBounds\)[\s\S]*?alignModelBottomToTargetBounds\(realModel, taskTargetBounds\)[\s\S]*?if \(didMoveModel\) \{[\s\S]*?alignMeetingRoomSplatRightFaceToGeometry\(\)/,
  'keeps geometry, real GLB, and meeting-room 3DGS aligned to the task bounding box',
)
assert.match(
  source,
  /alignMeetingRoomSplatRightFaceToGeometry\(\)[\s\S]*?updateMeetingRoomSplatDebugGroup\(\)/,
  'refreshes the meeting-room 3DGS debug box after loading and aligning the splat',
)
assert.doesNotMatch(
  source,
  /async function syncMeetingRoomSplatForTask\(task = props\.currentTask\)[\s\S]*?patchMeetingRoomSplatClipMaterial\(/,
  'renders the meeting-room Gaussian splat without shader clipping',
)
assert.match(
  visualizationStateSource,
  /meeting_room_gaussian_scale:\s*1/,
  'defaults the meeting-room Gaussian splat scale multiplier to 1',
)
assert.match(
  visualizationStateSource,
  /meeting_room_gaussian_box_visible:\s*true/,
  'shows the meeting-room Gaussian debug box by default',
)
assert.match(
  source,
  /function canLoadGLTFModelConfig\(config\)[\s\S]*?config\.key === 'real' && isMeetingRoomTask\(\)[\s\S]*?return false/,
  'does not load the fallback real GLB for meeting-room tasks',
)
assert.match(
  source,
  /function isMeetingRoomRealModelLayerVisible\(task = props\.currentTask\)[\s\S]*?visibleLayerIds\.has\(`realModel:\$\{taskId\}`\)/,
  'loads the meeting-room splat from the real-model layer visibility',
)
assert.match(
  source,
  /async function syncMeetingRoomSplatForTask\(task = props\.currentTask\)[\s\S]*?isMeetingRoomRealModelLayerVisible\(task\)[\s\S]*?fetch\(MEETING_ROOM_SPLAT_URL\)/,
  'checks meeting-room real-model visibility before fetching the splat',
)
assert.match(
  source,
  /const MEETING_ROOM_CAMERA_FORWARD = new THREE\.Vector3\(1, 0, 0\)/,
  'uses world +X as the constrained meeting-room camera default forward direction',
)
assert.doesNotMatch(
  source,
  /camera\.up\.copy\(MEETING_ROOM_CAMERA_UP\)/,
  'does not override OrbitControls rotation up while constraining the meeting-room camera',
)
assert.match(
  source,
  /const MEETING_ROOM_CAMERA_DEFAULT_FORWARD_OFFSET_RATIO = 0\.24/,
  'nudges the default meeting-room camera forward from the minimum X face',
)
assert.match(
  source,
  /function alignMeetingRoomCameraForwardToYozPlane\(box\)[\s\S]*?forwardOffset[\s\S]*?camera\.position\.set\(box\.min\.x \+ forwardOffset,\s*center\.y,\s*center\.z\)[\s\S]*?addScaledVector\(MEETING_ROOM_CAMERA_FORWARD, distance\)/,
  'starts the constrained meeting-room camera near the minimum X face looking toward +X',
)
assert.match(
  source,
  /function getCameraKeyboardMoveAxes\(\)[\s\S]*?camera\.getWorldDirection\(direction\)[\s\S]*?right\.crossVectors\(direction, camera\.up\)/,
  'moves the camera with the normal current-view keyboard axes',
)
assert.match(
  source,
  /function applyMeetingRoomGaussianScale\(\)[\s\S]*?MEETING_ROOM_SPLAT_SCALE \* resolveMeetingRoomGaussianScale\(\)[\s\S]*?setSplatScale\?\.\(scale\)[\s\S]*?applyMeetingRoomSplatObjectTransform\(\)/,
  'applies the meeting-room Gaussian scale and keeps the splat rotation transform synchronized',
)
assert.match(
  source,
  /props\.visualization\?\.meeting_room_gaussian_scale[\s\S]*?applyMeetingRoomGaussianScale\(\)/,
  'updates the meeting-room Gaussian scale from visualization settings',
)
assert.match(
  homeViewSource,
  /高斯缩放[\s\S]*?v-model="visualization\.meeting_room_gaussian_scale"[\s\S]*?:min="0\.5"[\s\S]*?:max="2"/,
  'exposes a Gaussian scale slider in the real-model layer settings',
)
assert.match(
  homeViewSource,
  /高斯绿框[\s\S]*?v-model="visualization\.meeting_room_gaussian_box_visible"/,
  'exposes a Gaussian debug box visibility switch in the real-model layer settings',
)
assert.match(
  source,
  /function updateMeetingRoomSplatDebugGroup\(\)[\s\S]*?disposeMeetingRoomSplatDebugGroup\(\)[\s\S]*?isMeetingRoomSplatDebugBoxVisible\(\)[\s\S]*?return/,
  'removes the meeting-room Gaussian debug box when the visibility switch is off',
)
assert.match(
  source,
  /props\.visualization\?\.meeting_room_gaussian_box_visible[\s\S]*?updateMeetingRoomSplatDebugGroup\(\)/,
  'updates the meeting-room Gaussian debug box when its visibility setting changes',
)
assert.doesNotMatch(
  source,
  /addFrameCallback\(constrainMeetingRoomCameraFrame\)|removeFrameCallback\(constrainMeetingRoomCameraFrame\)|isMeetingRoomConstrained/,
  'does not constrain the meeting-room camera or keyboard movement to the 3DGS box',
)
assert.match(
  source,
  /import \* as GaussianSplats3D from '@mkkellogg\/gaussian-splats-3d'/,
  'keeps the Gaussian Splat loader available for the real-model splat',
)

assert.doesNotMatch(
  source,
  /const geometryTargetBounds = geometryModel[\s\S]*?boxToTargetBounds/,
  'scales the real model from task bounds, not from the already-scaled geometry bounds',
)

assert.match(
  source,
  /const PERSON_MODEL_TRANSFORM = \{[\s\S]*?position:\s*\[[^\]]+\][\s\S]*?rotation:\s*\[Math\.PI\s*\/\s*2,\s*Math\.PI,\s*0\][\s\S]*?scale:\s*\[[^\]]+\][\s\S]*?\}/,
  'defines one shared person transform',
)

const personGeometryConfigMatch = source.match(
  /key:\s*'personGeometry'[\s\S]*?url:\s*'\/person\.glb'[\s\S]*?\n\s*}/,
)
const personRealConfigMatch = source.match(
  /key:\s*'personReal'[\s\S]*?url:\s*'\/person\.glb'[\s\S]*?\n\s*}/,
)

assert.ok(personGeometryConfigMatch, 'finds the model-layer person GLB config')
assert.ok(personRealConfigMatch, 'finds the real-model-layer person GLB config')

assert.match(
  personGeometryConfigMatch[0],
  /layerKind:\s*'model'/,
  'shows the person with the geometry model layer',
)
assert.match(
  personRealConfigMatch[0],
  /layerKind:\s*'realModel'/,
  'shows the person with the real model layer',
)
assert.match(
  personGeometryConfigMatch[0],
  /\.\.\.PERSON_MODEL_TRANSFORM/,
  'uses the shared person transform for the geometry model layer',
)
assert.match(
  personRealConfigMatch[0],
  /\.\.\.PERSON_MODEL_TRANSFORM/,
  'uses the shared person transform for the real model layer',
)
assert.match(
  personGeometryConfigMatch[0],
  /hideWhenRealModelVisible:\s*true/,
  'hides the model-layer person while the real model layer is visible',
)
assert.match(
  personGeometryConfigMatch[0],
  /useSolidMaterial:\s*true/,
  'uses a solid untextured material for the geometry person',
)
assert.match(
  personRealConfigMatch[0],
  /useRealModelOpacity:\s*true/,
  'uses the real model opacity for the real-layer person',
)
assert.match(
  source,
  /function createPersonScanOverlay\(model\)/,
  'defines a scan overlay helper for selected person targets',
)
assert.match(
  source,
  /function setPersonScanOverlayVisible\(visible\)/,
  'can toggle the selected person scan overlay',
)
assert.match(
  source,
  /MeshBasicMaterial\(\{[\s\S]*?color:\s*0x00f3ff[\s\S]*?transparent:\s*true[\s\S]*?opacity:\s*0\.82\s*\*\s*sourceOpacity[\s\S]*?depthTest:\s*false[\s\S]*?depthWrite:\s*false[\s\S]*?\}\)/,
  'renders the scan overlay through walls with opacity tied to the source model',
)
assert.match(
  source,
  /LineBasicMaterial\(\{[\s\S]*?color:\s*0x7df9ff[\s\S]*?transparent:\s*true[\s\S]*?opacity:\s*0\.55\s*\*\s*sourceOpacity[\s\S]*?depthTest:\s*false[\s\S]*?depthWrite:\s*false[\s\S]*?\}\)/,
  'renders the scan outline through walls with opacity tied to the source model',
)
assert.match(
  source,
  /function updatePersonScanOverlayOpacity\(\)/,
  'updates an existing person scan overlay when opacity sliders change',
)
assert.match(
  source,
  /function applySolidModelMaterial\(model,\s*config\)/,
  'defines a helper that replaces selected GLB materials with solid materials',
)
assert.match(
  visualizationStateSource,
  /person_model_opacity:\s*1/,
  'defaults the geometry person opacity to fully opaque',
)
assert.match(
  source,
  /config\?\.key\s*===\s*'personGeometry'[\s\S]*?props\.visualization\?\.person_model_opacity/,
  'resolves person geometry opacity from its own visualization setting',
)
assert.match(
  visualizationStateSource,
  /person_real_model_opacity:\s*1/,
  'defaults the real-model person opacity to fully opaque',
)
assert.match(
  source,
  /config\?\.key\s*===\s*'personReal'[\s\S]*?props\.visualization\?\.person_real_model_opacity/,
  'resolves real-model person opacity from its own visualization setting',
)
assert.match(
  homeViewSource,
  /v-model="visualization\.person_model_opacity"/,
  'exposes a separate person opacity slider in the model settings popover',
)
assert.match(
  homeViewSource,
  /v-model="visualization\.person_real_model_opacity"/,
  'exposes a separate real-model person opacity slider in the model settings popover',
)
assert.match(
  homeViewSource,
  /function taskHasLocalRealModelUrl\(task\)[\s\S]*?isMeetingRoomTask\(task\)/,
  'recognizes meeting-room tasks as having a local real model',
)
assert.match(
  homeViewSource,
  /const hasLocalRealModel = taskHasLocalRealModelUrl\(task\)[\s\S]*?!completed && !hasGeometryGlb && !hasLocalRealModel[\s\S]*?if \(completed \|\| hasLocalRealModel\)[\s\S]*?registerGeneratedLayer\('realModel'/,
  'registers the real-model layer when a non-completed meeting-room task has local real model data',
)

assert.match(
  source,
  /function applyModelAnimationFrame\(model,\s*animations,\s*config\)/,
  'defines a helper that samples a single GLB animation frame',
)
assert.match(
  source,
  /const PERSON_MODEL_TRANSFORM = \{[\s\S]*?animationFrameTime:\s*0[\s\S]*?\}/,
  'samples the first animation frame for both person model layers',
)
assert.match(
  personGeometryConfigMatch[0],
  /\.\.\.PERSON_MODEL_TRANSFORM/,
  'inherits the person animation frame for the geometry layer',
)
assert.match(
  source,
  /key:\s*'real'[\s\S]*?scaleToBounds:\s*false/,
  'keeps the real-model GLB at its configured size instead of fitting task bounds',
)
assert.match(
  source,
  /if \(geometryConfig\?\.scaleToBounds !== false\)[\s\S]*?scaleModelToTargetBounds\(\s*geometryModel/,
  'skips geometry bounds scaling when disabled',
)
assert.match(
  source,
  /if \(realConfig\?\.scaleToBounds !== false\)[\s\S]*?scaleModelToTargetBounds\(\s*realModel/,
  'skips real-model bounds scaling when disabled',
)
assert.doesNotMatch(
  source,
  /alignModelToTargetBounds/,
  'does not translate GLBs by an anchor when bounds scaling is disabled',
)
