export class AppError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid_request') { super(message); }
}
export function message(error: unknown) { return error instanceof Error ? error.message : 'Erro inesperado'; }
