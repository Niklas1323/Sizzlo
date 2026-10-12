import { isLocalDate } from '../domain/dates.ts';
import type { LocalDate } from '../domain/dates.ts';
import { HttpError } from './errors.ts';

export type Body = Record<string, unknown>;

export function asObject(value: unknown): Body {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_body', 'Expected a JSON object.');
  }
  return value as Body;
}

export function requiredStars(body: Body): 1 | 2 | 3 {
  const value = body.stars;
  if (value !== 1 && value !== 2 && value !== 3) throw new HttpError(400, 'invalid_field', 'stars must be 1, 2 or 3.');
  return value;
}

export function optionalString(body: Body, key: string, opts: { min?: number; max: number }): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_field', `${key} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < (opts.min ?? 0) || trimmed.length > opts.max) {
    throw new HttpError(400, 'invalid_field', `${key} must be ${opts.min ?? 0}–${opts.max} characters.`);
  }
  return trimmed;
}

export function requiredString(body: Body, key: string, opts: { min?: number; max: number }): string {
  const value = optionalString(body, key, { min: opts.min ?? 1, max: opts.max });
  if (value === undefined) throw new HttpError(400, 'missing_field', `${key} is required.`);
  return value;
}

export function optionalEnum<T extends string>(body: Body, key: string, allowed: readonly T[]): T | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new HttpError(400, 'invalid_field', `${key} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

/** Like optionalEnum, but an explicit null is kept so the field can be cleared. */
export function nullableEnum<T extends string>(body: Body, key: string, allowed: readonly T[]): T | null | undefined {
  if (body[key] === null) return null;
  return optionalEnum(body, key, allowed);
}

export function requiredEnum<T extends string>(body: Body, key: string, allowed: readonly T[]): T {
  const value = optionalEnum(body, key, allowed);
  if (value === undefined) throw new HttpError(400, 'missing_field', `${key} is required.`);
  return value;
}

export function optionalDate(body: Body, key: string): LocalDate | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!isLocalDate(value)) throw new HttpError(400, 'invalid_field', `${key} must be a date like 2026-10-12.`);
  return value;
}

export function requiredDate(body: Body, key: string): LocalDate {
  const value = optionalDate(body, key);
  if (value === undefined) throw new HttpError(400, 'missing_field', `${key} is required.`);
  return value;
}

export function optionalStringList<T extends string>(body: Body, key: string, allowed: readonly T[]): T[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && (allowed as readonly string[]).includes(v))) {
    throw new HttpError(400, 'invalid_field', `${key} must be a list of: ${allowed.join(', ')}.`);
  }
  return value as T[];
}

export function intParam(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) throw new HttpError(404, 'not_found', `Unknown ${name}.`);
  return Number(raw);
}

export function queryInt(params: URLSearchParams, key: string, opts: { min: number; max: number; fallback: number }): number {
  const raw = params.get(key);
  if (raw === null) return opts.fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < opts.min || n > opts.max) {
    throw new HttpError(400, 'invalid_query', `${key} must be a whole number from ${opts.min} to ${opts.max}.`);
  }
  return n;
}
