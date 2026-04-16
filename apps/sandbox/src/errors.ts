export class SandboxHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxHttpError';
  }
}

export class SandboxAuthenticationError extends SandboxHttpError {
  constructor(message = 'Internal runtime token is missing or invalid.') {
    super(401, 'authentication_failed', message);
  }
}

export class SandboxConflictError extends SandboxHttpError {
  constructor(message: string) {
    super(409, 'state_conflict', message);
  }
}

export class SandboxNotFoundError extends SandboxHttpError {
  constructor(message: string) {
    super(404, 'not_found', message);
  }
}

export class SandboxValidationError extends SandboxHttpError {
  constructor(message: string) {
    super(400, 'validation_failed', message);
  }
}
