module.exports = async function mapLimit (items, limit, fn) {
  // A NaN or 0 limit would start no workers and silently return an array of holes
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapLimit: limit must be a positive integer, got ${limit}`)
  }
  const results = new Array(items.length)
  let next = 0
  async function worker () {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  return results
}
