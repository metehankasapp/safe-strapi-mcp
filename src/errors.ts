import { z } from 'zod';

export const errorCodes = [
  'AMBIGUOUS_SELECTOR',
  'CONFIG_ERROR',
  'DRAFT_CHANGED',
  'DRAFT_NOT_OWNED',
  'FORBIDDEN_ORIGIN',
  'IDEMPOTENCY_CONFLICT',
  'INSUFFICIENT_SCOPE',
  'INDEX_OUT_OF_RANGE',
  'INTERNAL_ERROR',
  'INVALID_REQUEST',
  'OPERATION_BUSY',
  'WRITE_OUTCOME_UNKNOWN',
  'REQUEST_TOO_LARGE',
  'PROJECT_FORBIDDEN',
  'RATE_LIMITED',
  'SCHEMA_VALIDATION_FAILED',
  'SELECTOR_NOT_FOUND',
  'SOURCE_CHANGED',
  'SOURCE_NOT_FOUND',
  'STRAPI_ERROR',
  'TOKEN_MISSING',
  'UNAUTHORIZED',
  'VERIFICATION_FAILED',
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface StructuredError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export function toStructuredError(error: unknown): StructuredError {
  if (error instanceof AppError) return { code: error.code, message: error.message, details: error.details };
  return {
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  };
}
