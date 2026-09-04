/**
 * Serializa commits foreground da máquina (BOT_MOVE / eventos / handoff)
 * para o heartbeat não disputar o CAS.
 */

let depth = 0
let sharedSerializer = null

export function beginBotForegroundCommit() {
  depth += 1
  return depth
}

export function endBotForegroundCommit() {
  depth = Math.max(0, depth - 1)
  return depth
}

export function getBotForegroundCommitDepth() {
  return depth
}

export function isBotForegroundCommitActive() {
  return depth > 0
}

export function getSharedBotCommitSerializer() {
  if (!sharedSerializer) sharedSerializer = createBotCommitSerializer()
  return sharedSerializer
}

export function __resetBotForegroundCommitForTests() {
  depth = 0
  sharedSerializer = null
}

export function createBotCommitSerializer() {
  let chain = Promise.resolve()
  let inflight = 0
  let concurrent = 0
  let maxConcurrent = 0

  return {
    enqueue(task) {
      inflight += 1
      beginBotForegroundCommit()
      const run = () => Promise.resolve().then(task)
      const p = chain.then(run, run).then(
        (value) => value,
        (err) => {
          throw err
        },
      )
      chain = p.then(
        () => {},
        () => {},
      )
      return p.finally(() => {
        inflight = Math.max(0, inflight - 1)
        endBotForegroundCommit()
      })
    },
    wrap(task) {
      return this.enqueue(async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        try {
          return await task()
        } finally {
          concurrent -= 1
        }
      })
    },
    get inflight() {
      return inflight
    },
    get maxConcurrent() {
      return maxConcurrent
    },
    isIdle() {
      return inflight === 0
    },
  }
}
