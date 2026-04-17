import type { AnalyticsWindow } from '@echidna-claw/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentsApi } from './api.js';

export const agentsQueryKey = ['agents'];
export const agentDetailQueryKey = (agentId: string) => ['agents', agentId];
export const agentProvisioningQueryKey = (agentId: string) => ['agents', agentId, 'provisioning'];
export const agentAnalyticsQueryKey = (agentId: string, window?: AnalyticsWindow) => [
  'analytics',
  'agent',
  agentId,
  window ?? 'default',
];
export const readinessQueryKey = ['readiness'];

export function useAgentsQuery() {
  return useQuery({
    queryFn: () => agentsApi.listAgents(),
    queryKey: agentsQueryKey,
  });
}

export function useReadinessQuery() {
  return useQuery({
    queryFn: () => agentsApi.getReadiness(),
    queryKey: readinessQueryKey,
  });
}

export function useCreateAgentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentsApi.createAgent,
    onSuccess: async (detail) => {
      queryClient.setQueryData(agentDetailQueryKey(detail.agent.id), detail);
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
  });
}

export function useAgentQuery(agentId: string) {
  return useQuery({
    enabled: agentId.length > 0,
    queryFn: () => agentsApi.getAgent(agentId),
    queryKey: agentDetailQueryKey(agentId),
  });
}

export function useAgentAnalyticsQuery(agentId: string, window?: AnalyticsWindow) {
  return useQuery({
    enabled: agentId.length > 0,
    queryFn: () => agentsApi.getAgentAnalytics(agentId, window),
    queryKey: agentAnalyticsQueryKey(agentId, window),
  });
}

export function useTelegramProvisioningHandoffQuery(agentId: string) {
  return useQuery({
    enabled: agentId.length > 0,
    queryFn: () => agentsApi.getTelegramProvisioningHandoff(agentId),
    queryKey: agentProvisioningQueryKey(agentId),
  });
}

export function useSoftDeleteAgentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentsApi.softDeleteAgent,
    onSuccess: async (detail) => {
      queryClient.setQueryData(agentDetailQueryKey(detail.agent.id), detail);
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
  });
}

export function useRestoreAgentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentsApi.restoreAgent,
    onSuccess: async (detail) => {
      queryClient.setQueryData(agentDetailQueryKey(detail.agent.id), detail);
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
  });
}

export function useRetryAgentProvisioningMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentsApi.retryAgentProvisioning,
    onSuccess: async (detail, agentId) => {
      queryClient.setQueryData(agentDetailQueryKey(detail.agent.id), detail);
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
      await queryClient.invalidateQueries({ queryKey: agentDetailQueryKey(agentId) });
      await queryClient.invalidateQueries({ queryKey: agentProvisioningQueryKey(agentId) });
    },
  });
}

export function useSubmitTelegramBotTokenMutation(agentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { botToken: string }) => agentsApi.submitTelegramBotToken(agentId, input),
    onSuccess: async (handoff) => {
      queryClient.setQueryData(agentProvisioningQueryKey(agentId), handoff);
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
      await queryClient.invalidateQueries({ queryKey: agentDetailQueryKey(agentId) });
      await queryClient.invalidateQueries({ queryKey: agentProvisioningQueryKey(agentId) });
    },
  });
}
