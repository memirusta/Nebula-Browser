export interface VersionedSnapshot<T> {
  revision: number
  value: T
}

export async function allSettledOrThrow(
  promises: Promise<unknown>[],
  message: string,
): Promise<void> {
  const results = await Promise.allSettled(promises)
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
  if (failures.length > 0) {
    throw new AggregateError(failures, `${message} (${failures.length} failure(s)).`)
  }
}

interface KeyState {
  appliedRevision: number
  appliedGeneration: number
  generation: number
  chain: Promise<void>
}

/**
 * Serializes asynchronous writes per key and catches up to the newest snapshot
 * before the chain becomes idle. An older completion can therefore never be
 * recorded as though it applied a newer revision.
 */
export class LatestPerKeyRunner<K, T> {
  private readonly states = new Map<K, KeyState>()
  private readonly getSnapshot: () => VersionedSnapshot<T>
  private readonly apply: (key: K, value: T) => Promise<void>

  constructor(
    getSnapshot: () => VersionedSnapshot<T>,
    apply: (key: K, value: T) => Promise<void>,
  ) {
    this.getSnapshot = getSnapshot
    this.apply = apply
  }

  async run(key: K): Promise<void> {
    const state = this.states.get(key) ?? {
      appliedRevision: -1,
      appliedGeneration: -1,
      generation: 0,
      chain: Promise.resolve(),
    }
    this.states.set(key, state)

    const task = state.chain.catch(() => undefined).then(async () => {
      for (;;) {
        const snapshot = this.getSnapshot()
        const generation = state.generation
        if (
          state.appliedGeneration === generation &&
          state.appliedRevision >= snapshot.revision
        ) {
          return
        }

        await this.apply(key, snapshot.value)
        if (state.generation !== generation) continue

        state.appliedGeneration = generation
        state.appliedRevision = snapshot.revision

        if (this.getSnapshot().revision === snapshot.revision) return
      }
    })
    state.chain = task
    await task
  }

  invalidate(key: K): void {
    const state = this.states.get(key)
    if (state) state.generation += 1
  }
}
