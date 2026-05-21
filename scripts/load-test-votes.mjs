const databaseUrl = 'https://poll-slide-studio-default-rtdb.europe-west1.firebasedatabase.app'
const totalVotes = Number(process.argv[2] ?? 200)
const concurrency = Number(process.argv[3] ?? totalVotes)
const mode = process.argv[4] ?? 'round-robin'

const jsonUrl = (path) => `${databaseUrl}/${path}.json`

const readJson = async (path) => {
  const response = await fetch(jsonUrl(path))
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`)
  return response.json()
}

const parseStateValue = (data, fallback) => {
  if (!data || typeof data !== 'object') return fallback
  if (data.value && typeof data.value === 'object') return data.value
  if (typeof data.json === 'string') return JSON.parse(data.json)
  return fallback
}

const incrementWithRetry = async (path, retries = 40) => {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const currentResponse = await fetch(jsonUrl(path), {
        headers: { 'X-Firebase-ETag': 'true' },
      })
      if (!currentResponse.ok) throw new Error(`GET ${path}: ${currentResponse.status}`)
      const etag = currentResponse.headers.get('etag')
      const current = await currentResponse.json()
      const next = typeof current === 'number' ? current + 1 : 1
      const putResponse = await fetch(jsonUrl(path), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': etag ?? '*',
        },
        body: JSON.stringify(next),
      })
      if (putResponse.ok) return true
      if (putResponse.status !== 412) throw new Error(`PUT ${path}: ${putResponse.status}`)
    } catch (error) {
      if (attempt === retries - 1) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 80 + attempt * 45))
  }
  return false
}

const runLimited = async (items, limit, task) => {
  const results = []
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      results[currentIndex] = await task(items[currentIndex], currentIndex)
    }
  })
  await Promise.all(workers)
  return results
}

const sumSlideVotes = (votes, slideId) =>
  Object.values(votes?.[slideId] ?? {}).reduce((sum, count) => sum + (typeof count === 'number' ? count : 0), 0)

const openPollsData = await readJson('pollSlideStudioState/openPolls')
const openPolls = parseStateValue(openPollsData, {})
const activeEntry = Object.entries(openPolls).find(([, value]) => value && typeof value === 'object' && value.isOpen)

if (!activeEntry) {
  console.log(JSON.stringify({ ok: false, error: 'Нет открытого опроса' }, null, 2))
  process.exit(1)
}

const [slideId, activePoll] = activeEntry
const options = activePoll.poll?.options ?? []
if (!options.length) {
  console.log(JSON.stringify({ ok: false, error: 'У открытого опроса нет вариантов ответа', slideId }, null, 2))
  process.exit(1)
}

const beforeVotes = await readJson('pollSlideStudioVotes')
const beforeTotal = sumSlideVotes(beforeVotes, slideId)
const startedAt = Date.now()

const voteItems = Array.from({ length: totalVotes }, (_, index) => {
  const option = mode === 'same-option' ? options[0] : options[index % options.length]
  return option
})

const results = await runLimited(voteItems, concurrency, (option) =>
  incrementWithRetry(`pollSlideStudioVotes/${slideId}/${option.id}`)
    .then((ok) => ({ ok, optionId: option.id }))
    .catch((error) => ({ ok: false, optionId: option.id, error: error.message })),
)

const afterVotes = await readJson('pollSlideStudioVotes')
const afterTotal = sumSlideVotes(afterVotes, slideId)
const failed = results.filter((result) => !result.ok)

console.log(JSON.stringify({
  ok: failed.length === 0 && afterTotal - beforeTotal === totalVotes,
  slideId,
  question: activePoll.poll?.question ?? activePoll.title ?? '',
  requestedVotes: totalVotes,
  concurrency,
  mode,
  targetOption: mode === 'same-option' ? options[0]?.text : null,
  successfulRequests: results.length - failed.length,
  failedRequests: failed.length,
  beforeTotal,
  afterTotal,
  addedVotes: afterTotal - beforeTotal,
  durationMs: Date.now() - startedAt,
  failedSample: failed.slice(0, 5),
}, null, 2))
