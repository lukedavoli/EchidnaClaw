import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentsApi } from './api.js';

export const agentsQueryKey = ['agents'];
export const agentProvisioningQueryKey = (agentId: string) => ['agents', 'provisioning', agentId];
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
  });
}

export function useRestoreAgentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentsApi.restoreAgent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
  });
}

export function useRetryAgentProvisioningMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentsApi.retryAgentProvisioning,
    onSuccess: async (_, agentId) => {
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
      await queryClient.invalidateQueries({ queryKey: agentProvisioningQueryKey(agentId) });
    },
  });
}

export function useSubmitTelegramBotTokenMutation(agentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { botToken: string }) => agentsApi.submitTelegramBotToken(agentId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentsQueryKey });
      await queryClient.invalidateQueries({ queryKey: agentProvisioningQueryKey(agentId) });
    },
  });
}
