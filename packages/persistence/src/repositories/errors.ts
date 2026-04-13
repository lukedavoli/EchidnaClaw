export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class RecordConflictError extends PersistenceError {}

export class DuplicateRecordError extends RecordConflictError {}

export class OptimisticConcurrencyError extends RecordConflictError {}

export class RecordNotFoundError extends PersistenceError {}

export class InvalidBatchOperationError extends PersistenceError {}
