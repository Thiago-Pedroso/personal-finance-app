// One in-process serialization point for every mutation delegated to Python.
// A rejected task deliberately does not poison the queue.
let lock = Promise.resolve()
export const serializeWrite = (task) => {
  const next = lock.then(task, task)
  lock = next.catch(() => undefined)
  return next
}
