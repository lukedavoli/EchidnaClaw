import { Button, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  isApiClientError,
  isDependencyUnavailableError,
  isReservedApiError,
} from '../../../lib/api/errors.js';
import { EmptyState } from '../../shell/components/empty-state.js';
import { ErrorPanel } from '../../shell/components/error-panel.js';
import { PageHeader } from '../../shell/components/page-header.js';
import { RefreshButton } from '../../shell/components/refresh-button.js';
import {
  useAgentsQuery,
  useRestoreAgentMutation,
  useSoftDeleteAgentMutation,
} from '../hooks.js';
import type { AgentViewModel } from '../models.js';
import { toAgentViewModel } from '../models.js';
import { AgentList } from '../components/agent-list.js';
import { ArchiveAgentDialog } from '../components/archive-agent-dialog.js';

type DialogState = {
  agent: AgentViewModel;
  mode: 'archive' | 'restore';
} | null;

function AgentListSkeleton() {
  return (
    <Stack gap="md">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton height={188} key={index} radius="xl" />
      ))}
    </Stack>
  );
}

export function AgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const agentsQuery = useAgentsQuery();
  const softDeleteMutation = useSoftDeleteAgentMutation();
  const restoreMutation = useRestoreAgentMutation();
  const view = searchParams.get('view') === 'archived' ? 'archived' : 'active';

  const viewModels = (agentsQuery.data ?? []).map((agent) => toAgentViewModel(agent));
  const activeAgents = viewModels.filter((agent) => !agent.isArchived);
  const archivedAgents = viewModels.filter((agent) => agent.isArchived);
  const visibleAgents = view === 'archived' ? archivedAgents : activeAgents;
  const busyAgentId =
    (softDeleteMutation.isPending ? softDeleteMutation.variables : null) ??
    (restoreMutation.isPending ? restoreMutation.variables : null);

  async function runDialogAction() {
    if (!dialogState) {
      return;
    }

    try {
      if (dialogState.mode === 'archive') {
        await softDeleteMutation.mutateAsync(dialogState.agent.id);
        notifications.show({
          color: 'teal',
          message: `${dialogState.agent.name} moved to the archived roster.`,
          title: 'Agent archived',
        });
      } else {
        await restoreMutation.mutateAsync(dialogState.agent.id);
        notifications.show({
          color: 'teal',
          message: `${dialogState.agent.name} is active again.`,
          title: 'Agent restored',
        });
      }

      setDialogState(null);
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          isApiClientError(error) && error.traceId
            ? `${error.message} (${error.traceId})`
            : isApiClientError(error)
              ? error.message
              : 'The mutation failed unexpectedly.',
        title: dialogState.mode === 'archive' ? 'Archive failed' : 'Restore failed',
      });
    }
  }

  return (
    <Stack gap="xl">
      <PageHeader
        actions={
          <>
            <RefreshButton
              onClick={() => {
                void agentsQuery.refetch();
              }}
              refreshing={agentsQuery.isFetching && !agentsQuery.isLoading}
            />
            <Button component={Link} to="/agents/new">
              Create agent
            </Button>
          </>
        }
        description="Manage active and archived agents, inspect lifecycle state, and reserve the future provisioning actions that later steps will wire to backend behavior."
        title="Agents"
      />

      <SegmentedControl
        data={[
          {
            label: `Active (${activeAgents.length})`,
            value: 'active',
          },
          {
            label: `Archived (${archivedAgents.length})`,
            value: 'archived',
          },
        ]}
        onChange={(nextView) => {
          setSearchParams(nextView === 'active' ? {} : { view: nextView });
        }}
        value={view}
        w="fit-content"
      />

      {agentsQuery.isLoading ? <AgentListSkeleton /> : null}

      {!agentsQuery.isLoading && agentsQuery.error && isReservedApiError(agentsQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry agents"
          description="The Step 6 admin surface is present, but agent persistence still reports not implemented. This shell is ready for the backend slice to land behind it."
          onAction={() => {
            void agentsQuery.refetch();
          }}
          title="Agents are reserved in the backend"
          tone="info"
          traceId={isApiClientError(agentsQuery.error) ? agentsQuery.error.traceId : null}
        />
      ) : null}

      {!agentsQuery.isLoading &&
      agentsQuery.error &&
      isDependencyUnavailableError(agentsQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry agents"
          description="The agent routes exist, but one or more backing dependencies are unavailable right now."
          onAction={() => {
            void agentsQuery.refetch();
          }}
          title="Agent data is temporarily unavailable"
          tone="warning"
          traceId={isApiClientError(agentsQuery.error) ? agentsQuery.error.traceId : null}
        />
      ) : null}

      {!agentsQuery.isLoading &&
      agentsQuery.error &&
      !isReservedApiError(agentsQuery.error) &&
      !isDependencyUnavailableError(agentsQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry agents"
          description={
            isApiClientError(agentsQuery.error)
              ? agentsQuery.error.message
              : 'The control plane failed to load agents.'
          }
          onAction={() => {
            void agentsQuery.refetch();
          }}
          title="The agents page failed to load"
          traceId={isApiClientError(agentsQuery.error) ? agentsQuery.error.traceId : null}
        />
      ) : null}

      {!agentsQuery.isLoading &&
      !agentsQuery.error &&
      visibleAgents.length === 0 &&
      view === 'active' ? (
        <EmptyState
          actionLabel="Create the first agent"
          actionTo="/agents/new"
          description="No active agents exist yet. Create one to establish the operator lifecycle shell that later provisioning work will attach to."
          title="No active agents"
        />
      ) : null}

      {!agentsQuery.isLoading &&
      !agentsQuery.error &&
      visibleAgents.length === 0 &&
      view === 'archived' ? (
        <EmptyState
          description="Archived agents will appear here after a soft-delete action."
          title="No archived agents"
        />
      ) : null}

      {!agentsQuery.isLoading && !agentsQuery.error && visibleAgents.length > 0 ? (
        <>
          <Text c="dimmed" size="sm">
            Reserved controls stay visible on each card so later lifecycle work can plug in without a
            UI rewrite.
          </Text>
          <AgentList
            agents={visibleAgents}
            busyAgentId={busyAgentId}
            onArchive={(agent) => {
              setDialogState({
                agent,
                mode: 'archive',
              });
            }}
            onRestore={(agent) => {
              setDialogState({
                agent,
                mode: 'restore',
              });
            }}
          />
        </>
      ) : null}

      <ArchiveAgentDialog
        agentName={dialogState?.agent.name ?? ''}
        loading={softDeleteMutation.isPending || restoreMutation.isPending}
        mode={dialogState?.mode ?? 'archive'}
        onClose={() => {
          if (!softDeleteMutation.isPending && !restoreMutation.isPending) {
            setDialogState(null);
          }
        }}
        onConfirm={() => {
          void runDialogAction();
        }}
        opened={dialogState !== null}
      />
    </Stack>
  );
}
