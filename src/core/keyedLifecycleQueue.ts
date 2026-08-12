export interface LifecycleLease {
  readonly generation: number
  isCurrent(): boolean
}

interface LifecycleState {
  generation: number
  tail: Promise<void>
}

/** Serializes lifecycle work per key and lets destructive work invalidate older leases. */
export class KeyedLifecycleQueue<K> {
  private readonly states = new Map<K, LifecycleState>()

  private stateFor(key: K): LifecycleState {
    const existing = this.states.get(key)
    if (existing) return existing

    const state: LifecycleState = {
      generation: 0,
      tail: Promise.resolve(),
    }
    this.states.set(key, state)
    return state
  }

  invalidate(key: K): number {
    const state = this.stateFor(key)
    state.generation += 1
    return state.generation
  }

  async run<T>(key: K, task: (lease: LifecycleLease) => Promise<T>): Promise<T> {
    const state = this.stateFor(key)
    const generation = state.generation
    const lease: LifecycleLease = {
      generation,
      isCurrent: () => state.generation === generation,
    }
    const result = state.tail
      .catch(() => undefined)
      .then(() => task(lease))
    state.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
