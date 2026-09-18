import type { ErrorCode } from '../shared/types'
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
  }
}
