import { BudgetExceededError } from './types.ts';
import type { MicroUsd } from './types.ts';

export interface Reservation { readonly amount: MicroUsd }

/**
 * Hard spending cap. A call must `reserve` its estimate before it runs, so a large batch
 * stops *before* it overspends rather than reporting the overspend afterwards.
 */
export class Budget {
  readonly limit: MicroUsd;
  #spent = 0;
  #reserved = 0;
  constructor(limit: MicroUsd) {
    this.limit = limit;
  }
  get spent(): MicroUsd { return this.#spent; }
  get remaining(): MicroUsd { return this.limit - this.#spent - this.#reserved; }

  reserve(amount: MicroUsd): Reservation {
    if (amount > this.remaining) {
      throw new BudgetExceededError(`Needs ${amount} micro-USD but only ${this.remaining} remain of ${this.limit}.`);
    }
    this.#reserved += amount;
    return { amount };
  }
  /** Settle a reservation at the real cost (defaults to the estimate). */
  commit(r: Reservation, actual: MicroUsd = r.amount): void {
    this.#reserved -= r.amount;
    this.#spent += actual;
  }
  release(r: Reservation): void {
    this.#reserved -= r.amount;
  }
}
