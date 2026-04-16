import type {
  Agent,
  EnqueueTaskResult,
  HandsFollowUpTaskRequest,
  HandsHandlerOutcome,
  HandsHandlerProgressUpdate,
  HandsRun,
  HandsRunExecutionResult,
  HandsStartRunRequest,
  RunJournal,
  SandboxCloseSessionRequest,
  SandboxCreateSessionRequest,
  SandboxExecuteCommandRequest,
  SandboxExecuteCommandResult,
  SandboxSession,
  Task,
  TaskEnvelope,
  WorkingContext,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';
import type {
  AgentRepository,
  ExecutionRepository,
  StoredRecord,
  TaskRepository,
  WorkingContextRepository,
} from '@echidna-claw/persistence';

export type ActiveExecutionState = {
  agent: StoredRecord<Agent>;
  handsRun: StoredRecord<HandsRun>;
  runJournal: StoredRecord<RunJournal>;
  task: StoredRecord<Task>;
  taskEnvelope: StoredRecord<TaskEnvelope>;
  workingContext: StoredRecord<WorkingContext>;
};

export type RuntimeScript = {
  dueAt?: string;
  failureCode?: string;
  failureMessage?: string;
  followUpTasks?: HandsFollowUpTaskRequest[];
  openQuestions?: string[];
  outcome?: HandsHandlerOutcome['kind'];
  progressMessages?: string[];
  resultCode?: string;
  sandboxCommand?: {
    command: string;
    packageAllowlistName?: string;
    policyName?: string;
    shell?: SandboxExecuteCommandRequest['shell'];
    timeoutMs?: number;
    workingDirectory?: string;
  };
  summary?: string;
};

export interface HandsRuntimeRepositories {
  agents: AgentRepository;
  execution: ExecutionRepository;
  tasks: TaskRepository;
  workingContexts: WorkingContextRepository;
}

export interface HandsFollowUpQueueClient {
  enqueueFollowUpTasks(input: {
    agentId: string;
    correlation: HandsStartRunRequest['correlation'];
    followUpTasks: HandsFollowUpTaskRequest[];
    handsRunId: string;
    taskId: string;
    workingContextId: string;
  }): Promise<{
    results: EnqueueTaskResult[];
  }>;
}

export interface HandsSandboxClient {
  closeSession(input: SandboxCloseSessionRequest): Promise<SandboxSession>;
  createSession(input: SandboxCreateSessionRequest): Promise<SandboxSession>;
  executeCommand(input: SandboxExecuteCommandRequest): Promise<SandboxExecuteCommandResult>;
  getSession(sessionId: string): Promise<SandboxSession>;
}

export interface HandsTaskSandboxClient {
  closeSession(input: Omit<SandboxCloseSessionRequest, 'correlation'>): Promise<SandboxSession>;
  createSession(
    input: Omit<SandboxCreateSessionRequest, 'agentId' | 'correlation' | 'handsRunId' | 'taskId'>,
  ): Promise<SandboxSession>;
  executeCommand(
    input: Omit<SandboxExecuteCommandRequest, 'correlation'>,
  ): Promise<SandboxExecuteCommandResult>;
  getSession(sessionId: string): Promise<SandboxSession>;
}

export interface HandsTaskHandlerContext {
  agent: Agent;
  checkpoint(label: string): Promise<void>;
  enqueueFollowUpTask(request: HandsFollowUpTaskRequest): Promise<EnqueueTaskResult>;
  handsRun: HandsRun;
  reportProgress(update: HandsHandlerProgressUpdate): Promise<void>;
  sandbox: HandsTaskSandboxClient;
  task: Task;
  taskEnvelope: TaskEnvelope;
}

export interface HandsTaskHandler {
  canHandle(taskType: string): boolean;
  execute(context: HandsTaskHandlerContext): Promise<HandsHandlerOutcome>;
}

export interface HandsExecutionCoordinator {
  executeDispatchedRun(input: HandsStartRunRequest): Promise<HandsRunExecutionResult>;
}

export interface HandsExecutionCoordinatorOptions {
  followUpQueue: HandsFollowUpQueueClient;
  handlers?: readonly HandsTaskHandler[];
  logger: Logger;
  now?: () => string;
  repositories: HandsRuntimeRepositories;
  sandbox: HandsSandboxClient;
  workerInstanceId: string;
}
