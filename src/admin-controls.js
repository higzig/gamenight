export function moveItem(items, index, direction) {
  const target = index + direction
  if (target < 0 || target >= items.length) return false
  ;[items[index], items[target]] = [items[target], items[index]]
  return true
}

export function runConfirmed(confirmFn, message, action) {
  if (!confirmFn(message)) return false
  action()
  return true
}
