export interface CoreOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface CoreErr<E = Error> {
  readonly ok: false;
  readonly error: E;
}

export type CoreResult<T, E = Error> = CoreOk<T> | CoreErr<E>;
export type Result<T, E = Error> = CoreResult<T, E>;

export function ok<T>(value: T): CoreOk<T> {
  return { ok: true, value };
}

export function err<E = Error>(error: E): CoreErr<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: CoreResult<T, E>): result is CoreOk<T> {
  return result.ok;
}

export function isErr<T, E>(result: CoreResult<T, E>): result is CoreErr<E> {
  return !result.ok;
}

export function unwrap<T, E extends Error>(result: CoreResult<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

export function unwrapOr<T, E>(result: CoreResult<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
