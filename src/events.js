const listeners = new Set()

export const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const emit = (event) => {
  for (const fn of listeners) fn(event)
}
