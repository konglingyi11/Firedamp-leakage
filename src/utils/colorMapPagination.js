export const DEFAULT_COLOR_MAP_PAGE_SIZE = 10

export function getColorMapPageItems(
  items,
  currentPage = 1,
  pageSize = DEFAULT_COLOR_MAP_PAGE_SIZE,
) {
  if (!Array.isArray(items)) return []

  const page = Math.max(1, Math.floor(Number(currentPage) || 1))
  const limit = Math.max(1, Math.floor(Number(pageSize) || DEFAULT_COLOR_MAP_PAGE_SIZE))

  if (items.length <= limit) return items

  const start = (page - 1) * limit
  return items.slice(start, start + limit)
}

export function getColorMapTotal(response, fallbackTotal = 0) {
  const total = response?.data?.total ?? response?.total ?? fallbackTotal
  const numericTotal = Number(total)
  return Number.isFinite(numericTotal) ? numericTotal : fallbackTotal
}
