import { NoProviderError } from './types.ts';
import type { Call, Kind, MicroUsd, Provider } from './types.ts';

export type Strategy = 'priority' | 'cheapest';

/**
 * Providers the user has configured (each with their own key). Routing never invents a provider:
 * only registered ones are candidates, in the order the user listed them or by estimated cost.
 */
export class Registry {
  #providers: Provider[] = [];
  register(p: Provider): this {
    if (this.#providers.some((x) => x.id === p.id)) throw new Error(`Provider already registered: ${p.id}`);
    this.#providers.push(p);
    return this;
  }
  get(id: string): Provider | undefined {
    return this.#providers.find((p) => p.id === id);
  }
  list(): readonly Provider[] {
    return this.#providers;
  }
  /** Candidates able to serve `call`, best first. Stable: ties keep registration order. */
  route(call: Call, strategy: Strategy = 'priority'): Provider[] {
    const ok = this.#providers.filter((p) => p.kinds.includes(call.kind));
    if (strategy === 'priority') return ok;
    return ok
      .map((p, i) => ({ p, i, c: p.estimate(call) }))
      .sort((a, b) => a.c - b.c || a.i - b.i)
      .map((x) => x.p);
  }
  /** Cheapest estimate across providers, used to price a batch before running it. */
  cheapest(call: Call): { provider: Provider; cost: MicroUsd } {
    const [provider] = this.route(call, 'cheapest');
    if (!provider) throw new NoProviderError(`No provider registered for ${call.kind}.`);
    return { provider, cost: provider.estimate(call) };
  }
  kindsCovered(): Kind[] {
    return [...new Set(this.#providers.flatMap((p) => [...p.kinds]))];
  }
}
