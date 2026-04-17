import type { AnalyticsWindow } from '@echidna-claw/contracts';
import { Card, SimpleGrid, Skeleton, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import {
  ApiClientError,
  isApiClientError,
  isDependencyUnavailableError,
} from '../../../lib/api/errors.js';
import { EmptyState } from '../../shell/components/empty-state.js';
import { ErrorPanel } from '../../shell/components/error-panel.js';
import { PageHeader } from '../../shell/components/page-header.js';
import { RefreshButton } from '../../shell/components/refresh-button.js';
import { toAgentAnalyticsViewModel, parseAnalyticsWindowValue } from '../../analytics/models.js';
import {
  useAgentAnalyticsQuery,
  useAgentQuery,
  useRestoreAgentMutation,
  useRetryAgentProvisioningMutation,
  useSoftDeleteAgentMutation,
  useSubmitTelegramBotTokenMutation,
  useTelegramProvisioningHandoffQuery,
} from '../hooks.js';
import { toAgentDetailViewModel } from '../models.js';
import { AgentChannelPanel } from '../components/agent-channel-panel.js';
import { AgentDetailHeader } from '../components/agent-detail-header.js';
import { AgentUsagePanel } from '../components/agent-usage-panel.js';
import { TelegramProvisioningPanel } from '../components/telegram-provisioning-panel.js';

function DetailSkeleton() {
  return (
    <Stack gap="md">
      <Skeleton height={220} radius="xl" />
      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
        <Skeleton height={320} radius="xl" />
        <Skeleton height={320} radius="xl" />
      </SimpleGrid>
      <Skeleton height={360} radius="xl" />
    </Stack>
  );
}

function ProvisioningSkeleton() {
  return <Skeleton height={320} radius="xl" />;
}

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const requestedWindow = parseAnalyticsWindowValue(searchParams.get('window'));

  if (!agentId) {
    return (
      <EmptyState
        actionLabel="Return to agents"
        actionTo="/agents"
        description="The agent detail route requires a concrete agent identifier."
        title="Agent not found"
      />
    );
  }

  const resolvedAgentId = agentId;
  const agentQuery = useAgentQuery(resolvedAgentId);
  const provisioningQuery = useTelegramProvisioningHandoffQuery(resolvedAgentId);
  const usageQuery = useAgentAnalyticsQuery(resolvedAgentId, requestedWindow);
  const softDeleteMutation = useSoftDeleteAgentMutation();
  const restoreMutation = useRestoreAgentMutation();
  const retryMutation = useRetryAgentProvisioningMutation();
  const submitTokenMutation = useSubmitTelegramBotTokenMutation(resolvedAgentId);

  const detail = agentQuery.data ? toAgentDetailViewModel(agentQuery.data) : null;
  const usage = usageQuery.data ? toAgentAnalyticsViewModel(usageQuery.data) : null;
  const selectedWindow = usage?.window ?? requestedWindow ?? '30d';
  const busy =
    softDeleteMutation.isPending ||
    restoreMutation.isPending ||
    retryMutation.isPending ||
    submitTokenMutation.isPending;

  function setWindow(nextWindow: AnalyticsWindow) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('window', nextWindow);
      return next;
    });
  }

  async function handleArchive() {
    if (!detail) {
      return;
    }

    try {
      await softDeleteMutation.mutateAsync(detail.id);
      notifications.show({
        color: 'teal',
        message: `${detail.name} moved to the archived roster.`,
        title: 'Agent archived',
      });
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          isApiClientError(error) && error.traceId
            ? `${error.message} (${error.traceId})`
            : isApiClientError(error)
              ? error.message
              : 'The archive action failed unexpectedly.',
        title: 'Archive failed',
      });
    }
  }

  async function handleRestore() {
    if (!detail) {
      return;
    }

    try {
      await restoreMutation.mutateAsync(detail.id);
      notifications.show({
        color: 'teal',
        message: `${detail.name} is active again.`,
        title: 'Agent restored',
      });
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          isApiClientError(error) && error.traceId
            ? `${error.message} (${error.traceId})`
            : isApiClientError(error)
              ? error.message
              : 'The restore action failed unexpectedly.',
        title: 'Restore failed',
      });
    }
  }

  async function handleRetry() {
    if (!detail) {
      return;
    }

    try {
      await retryMutation.mutateAsync(detail.id);
      await Promise.all([provisioningQuery.refetch(), usageQuery.refetch()]);
      notifications.show({
        color: 'teal',
        message: `${detail.name} returned to pending provisioning.`,
        title: 'Provisioning retry requested',
      });
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          isApiClientError(error) && error.traceId
            ? `${error.message} (${error.traceId})`
            : isApiClientError(error)
              ? error.message
              : 'Retry provisioning failed unexpectedly.',
        title: 'Retry provisioning failed',
      });
    }
  }

  async function handleSubmitToken(values: { botToken: string }) {
    setSubmitError(null);

    try {
      await submitTokenMutation.mutateAsync(values);
      notifications.show({
        color: 'teal',
        message: 'Telegram verified the bot token and prepared the bootstrap handoff.',
        title: 'Bot token verified',
      });
    } catch (error) {
      if (isApiClientError(error)) {
        setSubmitError(error);
        return;
      }

      setSubmitError(
        new ApiClientError({
          code: 'unexpected_error',
          kind: 'network',
          message: 'The Telegram bot token could not be verified.',
        }),
      );
    }
  }

  if (agentQuery.isLoading) {
    return <DetailSkeleton />;
  }

  if (agentQuery.error) {
    if (isApiClientError(agentQuery.error) && agentQuery.error.status === 404) {
      return (
        <EmptyState
          actionLabel="Return to agents"
          actionTo="/agents"
          description="The requested agent does not exist or is no longer available."
          title="Agent not found"
        />
      );
    }

    if (isDependencyUnavailableError(agentQuery.error)) {
      return (
        <ErrorPanel
          actionLabel="Retry agent"
          description="The agent exists, but one or more backing dependencies are unavailable right now."
          onAction={() => {
            void agentQuery.refetch();
          }}
          title="Agent data is temporarily unavailable"
          tone="warning"
          traceId={isApiClientError(agentQuery.error) ? agentQuery.error.traceId : null}
        />
      );
    }

    return (
      <ErrorPanel
        actionLabel="Retry agent"
        description={
          isApiClientError(agentQuery.error)
            ? agentQuery.error.message
            : 'The agent detail view failed to load.'
        }
        onAction={() => {
          void agentQuery.refetch();
        }}
        title="The agent detail page failed to load"
        traceId={isApiClientError(agentQuery.error) ? agentQuery.error.traceId : null}
      />
    );
  }

  if (!detail) {
    return null;
  }

  const provisioningSurface =
    provisioningQuery.isLoading && !provisioningQuery.data ? (
      <ProvisioningSkeleton />
    ) : provisioningQuery.data ? (
      <TelegramProvisioningPanel
        handoff={provisioningQuery.data}
        onRetry={handleRetry}
        onSubmitToken={handleSubmitToken}
        retrying={retryMutation.isPending}
        submitError={submitError}
        submittingToken={submitTokenMutation.isPending}
      />
    ) : provisioningQuery.error && isDependencyUnavailableError(provisioningQuery.error) ? (
      <ErrorPanel
        actionLabel="Retry provisioning"
        description="Telegram provisioning data is temporarily unavailable. The agent summary remains available above."
        onAction={() => {
          void provisioningQuery.refetch();
        }}
        title="Provisioning data is temporarily unavailable"
        tone="warning"
        traceId={isApiClientError(provisioningQuery.error) ? provisioningQuery.error.traceId : null}
      />
    ) : provisioningQuery.error ? (
      <ErrorPanel
        actionLabel="Retry provisioning"
        description={
          isApiClientError(provisioningQuery.error)
            ? provisioningQuery.error.message
            : 'The Telegram provisioning flow failed to load.'
        }
        onAction={() => {
          void provisioningQuery.refetch();
        }}
        title="The Telegram provisioning flow failed to load"
        traceId={isApiClientError(provisioningQuery.error) ? provisioningQuery.error.traceId : null}
      />
    ) : (
      <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
        Provisioning data is not available for this agent.
      </Card>
    );

  const secondarySurface = <AgentChannelPanel agent={detail} />;
  const surfaces =
    detail.provisioningState === 'active'
      ? [secondarySurface, provisioningSurface]
      : [provisioningSurface, secondarySurface];

  return (
    <Stack gap="xl">
      <PageHeader
        actions={
          <RefreshButton
            onClick={() => {
              void Promise.all([
                agentQuery.refetch(),
                provisioningQuery.refetch(),
                usageQuery.refetch(),
              ]);
            }}
            refreshing={
              (agentQuery.isFetching && !agentQuery.isLoading) ||
              (provisioningQuery.isFetching && !provisioningQuery.isLoading) ||
              (usageQuery.isFetching && !usageQuery.isLoading)
            }
          />
        }
        description="Provisioning state, Telegram channel metadata, archived reference context, and recent usage for this agent."
        title="Agent detail"
      />

      <AgentDetailHeader
        agent={detail}
        busy={busy}
        onArchive={() => {
          void handleArchive();
        }}
        onRestore={() => {
          void handleRestore();
        }}
        onRetry={() => {
          void handleRetry();
        }}
      />

      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
        {surfaces.map((surface, index) => (
          <div key={index}>{surface}</div>
        ))}
      </SimpleGrid>

      <AgentUsagePanel
        analytics={usage}
        error={isApiClientError(usageQuery.error) ? usageQuery.error : null}
        loading={usageQuery.isLoading}
        onWindowChange={setWindow}
        selectedWindow={selectedWindow}
      />
    </Stack>
  );
}
