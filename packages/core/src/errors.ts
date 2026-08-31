/**
 * Typed errors for the whole system. CLAUDE.md section 5: never throw a bare string.
 * A `code` is carried separately from the message so callers can branch on the code and
 * log the message, rather than parsing prose.
 */
export class KalibraError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** An argument violated a precondition stated in SCORING_SPEC.md. */
export class InvalidInputError extends KalibraError {
  constructor(message: string) {
    super('INVALID_INPUT', message);
  }
}

/**
 * A computation produced NaN or Infinity. SCORING_SPEC.md section 5.3 forbids these from
 * reaching the database, so the scoring path fails loudly here instead of persisting a
 * value that would silently poison a leaderboard.
 */
export class NonFiniteResultError extends KalibraError {
  constructor(message: string) {
    super('NON_FINITE_RESULT', message);
  }
}

export function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new NonFiniteResultError(`${label} is not finite: ${value}`);
  }
  return value;
}
