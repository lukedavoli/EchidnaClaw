import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentsApi } from './api.js';

export const agentsQueryKey = ['agents'];
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
