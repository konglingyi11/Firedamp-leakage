import { VARIABLE_ZH_NAME_MAP } from '@/utils/gas'

const taskVariablesByTaskId = new Map()

export function normalizeTaskVariableList(raw) {
  const list = raw?.data?.variables || raw?.variables || raw?.data || raw
  if (!Array.isArray(list)) return []

  const seen = new Set()
  const variables = []
  const zhNameToVariable = Object.fromEntries(
    Object.entries(VARIABLE_ZH_NAME_MAP).map(([variable, zhName]) => [
      zhName,
      variable,
    ]),
  )
  const canonicalVariableByLower = Object.fromEntries(
    Object.keys(VARIABLE_ZH_NAME_MAP).map((variable) => [
      variable.toLowerCase(),
      variable,
    ]),
  )

  const pickVariableId = (item) => {
    if (typeof item === 'string') {
      const value = item.trim()
      return (
        canonicalVariableByLower[value.toLowerCase()] ||
        zhNameToVariable[value] ||
        value
      )
    }
    const candidates = [
      item?.id,
      item?.variable,
      item?.variable_id,
      item?.variableId,
      item?.key,
      item?.slug,
      item?.field,
      item?.name,
    ]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
    return (
      candidates
        .map((value) => canonicalVariableByLower[value.toLowerCase()])
        .find(Boolean) ||
      candidates.find((value) =>
        value.toLowerCase().startsWith('mass_fraction_of_'),
      ) ||
      candidates.map((value) => zhNameToVariable[value]).find(Boolean) ||
      candidates.find(
        (value) => !zhNameToVariable[value] && !/^\d+$/.test(value),
      ) ||
      ''
    )
  }

  for (const item of list) {
    const value = pickVariableId(item)
    const variable = String(value ?? '').trim()
    if (!variable || seen.has(variable)) continue
    seen.add(variable)
    variables.push(variable)
  }
  return variables
}

export function getCachedTaskVariables(taskId) {
  if (!taskId) return null
  const variables = taskVariablesByTaskId.get(String(taskId))
  return Array.isArray(variables) ? [...variables] : null
}

export function setCachedTaskVariables(taskId, rawVariables) {
  if (!taskId) return []
  const variables = normalizeTaskVariableList(rawVariables)
  taskVariablesByTaskId.set(String(taskId), variables)
  return [...variables]
}
