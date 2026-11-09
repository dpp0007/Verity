export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public retryable = false) {
    super(message);
  }
}
export const errorBody = (e: ApiError) => ({ error: { code: e.code, message: e.message, retryable: e.retryable, details: e.details ?? null } });
