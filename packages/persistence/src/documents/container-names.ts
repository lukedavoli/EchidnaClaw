export const AGENT_STATE_CONTAINER_NAME = 'agent-state';
export const USAGE_EVENTS_CONTAINER_NAME = 'usage-events';

export type ContainerName =
  | typeof AGENT_STATE_CONTAINER_NAME
  | typeof USAGE_EVENTS_CONTAINER_NAME;
