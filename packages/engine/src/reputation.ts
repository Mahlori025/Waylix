/**
 * Reporter reputation as a Beta(α, β) posterior over "this reporter's reports
 * turn out to be true". New reporters start at Beta(2, 2) (neutral, low
 * certainty). Trust maps the posterior mean onto an evidence multiplier in
 * [0.25, 2.0], so a proven reporter's single report can activate a hazard,
 * while a spammer's reports quickly stop moving the needle.
 */
export interface ReputationRecord {
  alpha: number;
  beta: number;
}

export const NEUTRAL_REPUTATION: Readonly<ReputationRecord> = { alpha: 2, beta: 2 };

export class ReputationLedger {
  private readonly records = new Map<string, ReputationRecord>();

  constructor(initial?: Iterable<[string, ReputationRecord]>) {
    if (initial) for (const [k, v] of initial) this.records.set(k, { ...v });
  }

  get(reporterId: string): ReputationRecord {
    return this.records.get(reporterId) ?? { ...NEUTRAL_REPUTATION };
  }

  /** Evidence multiplier in [0.25, 2.0]. Neutral reporters get 1.0. */
  trust(reporterId: string): number {
    const r = this.get(reporterId);
    const mean = r.alpha / (r.alpha + r.beta);
    // Piecewise-linear: 0 → 0.25, 0.5 → 1.0, 1 → 2.0.
    return mean >= 0.5 ? 1 + 2 * (mean - 0.5) : 0.25 + 1.5 * mean;
  }

  /** Record that a reporter's claim was borne out (true) or contradicted (false). */
  record(reporterId: string, correct: boolean, weight = 1): ReputationRecord {
    const r = this.get(reporterId);
    const next = correct ? { alpha: r.alpha + weight, beta: r.beta } : { alpha: r.alpha, beta: r.beta + weight };
    this.records.set(reporterId, next);
    return next;
  }

  entries(): Array<[string, ReputationRecord]> {
    return [...this.records.entries()].map(([k, v]) => [k, { ...v }]);
  }
}
