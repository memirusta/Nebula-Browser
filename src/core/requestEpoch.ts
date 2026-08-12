export interface RequestEpochSnapshot<K> {
  key: K
  generation: number
}

export class RequestEpoch<K> {
  private key: K
  private generation = 0

  constructor(initialKey: K) {
    this.key = initialKey
  }

  sync(key: K): void {
    if (Object.is(this.key, key)) return
    this.key = key
    this.generation += 1
  }

  capture(): RequestEpochSnapshot<K> {
    return { key: this.key, generation: this.generation }
  }

  isCurrent(snapshot: RequestEpochSnapshot<K>): boolean {
    return (
      Object.is(this.key, snapshot.key) &&
      this.generation === snapshot.generation
    )
  }
}
