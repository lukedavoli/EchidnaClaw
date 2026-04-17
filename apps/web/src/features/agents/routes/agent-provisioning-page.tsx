import { Skeleton, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  ApiClientError,
  isApiClientError,
  isDependencyUnavailableError,
} from '../../../lib/api/errors.js';
import { EmptyState } from '../../shell/components/empty-state.js';
import { ErrorPanel } from '../../shell/components/error-panel.js';
import { PageHeader } from '../../shell/components/page-header.js';
import { RefreshButton } from '../../shell/components/refresh-button.js';
import {
  useRetryAgentProvisioningMutation,
  useSubmitTelegramBotTokenMutation,
  useTelegramProvisioningHandoffQuery,
} from '../hooks.js';
import { TelegramProvisioningPanel } from '../components/telegram-provisioning-panel.js';

function ProvisioningSkeleton() {
  return (
    <Stack gap="md">
      <Skeleton height={420} radius="xl" />
    </Stack>
  );
}

export function AgentProvisioningPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const [retryError, setRetryError] = useState<ApiClientError | null>(null);

  if (!agentId) {
    return (
      <EmptyState
        actionLabel="Return to agents"
        actionTo="/agents"
        description="The Telegram provisioning route requires a concrete agent identifier."
        title="Agent not found"
      />
    );
  }

  const resolvedAgentId = agentId;
  const provisioningQuery = useTelegramProvisioningHandoffQuery(resolvedAgentId);
  const retryMutation = useRetryAgentProvisioningMutation();
  const submitTokenMutation = useSubmitTelegramBotTokenMutation(resolvedAgentId);

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

  async function handleRetry() {
    setRetryError(null);

    try {
      await retryMutation.mutateAsync(resolvedAgentId);
      await provisioningQuery.refetch();
      notifications.show({
        color: 'teal',
        message: 'The Telegram provisioning attempt was reset.',
        title: 'Provisioning retry requested',
      });
    } catch (error) {
      if (isApiClientError(error)) {
        setRetryError(error);
        return;
      }

      setRetryError(
        new ApiClientError({
          code: 'unexpected_error',
          kind: 'network',
          message: 'The Telegram provisioning retry failed unexpectedly.',
        }),
      );
    }
  }

  return (
    <Stack gap="xl">
      <PageHeader
        actions={
          <RefreshButton
            onClick={() => {
              void provisioningQuery.refetch();
            }}
            refreshing={provisioningQuery.isFetching && !provisioningQuery.isLoading}
          />
        }
        description="Verify the Telegram bot token, configure the webhook, and complete the first trusted operator bind for this agent."
        title="Provision Telegram bot"
      />

      {provisioningQuery.isLoading ? <ProvisioningSkeleton /> : null}

      {!provisioningQuery.isLoading &&
      provisioningQuery.error &&
      isDependencyUnavailableError(provisioningQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry provisioning"
          description="The Telegram provisioning contract is available, but one or more backing dependencies are currently unavailable."
          onAction={() => {
            void provisioningQuery.refetch();
          }}
          title="Provisioning data is temporarily unavailable"
          tone="warning"
          traceId={
            isApiClientError(provisioningQuery.error) ? provisioningQuery.error.traceId : null
          }
        />
      ) : null}

      {!provisioningQuery.isLoading &&
      provisioningQuery.error &&
      !isDependencyUnavailableError(provisioningQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry provisioning"
          description={provisioningQuery.error.message}
          onAction={() => {
            void provisioningQuery.refetch();
          }}
          title="The Telegram provisioning flow failed to load"
          traceId={
            isApiClientError(provisioningQuery.error) ? provisioningQuery.error.traceId : null
          }
        />
      ) : null}

      {retryError ? (
        <ErrorPanel
          actionLabel="Retry again"
          description={retryError.message}
          onAction={() => {
            void handleRetry();
          }}
          title="The retry request failed"
          traceId={retryError.traceId}
        />
      ) : null}

      {!provisioningQuery.isLoading && provisioningQuery.data ? (
        <TelegramProvisioningPanel
          handoff={provisioningQuery.data}
          onRetry={handleRetry}
          onSubmitToken={handleSubmitToken}
          retrying={retryMutation.isPending}
          submitError={submitError}
          submittingToken={submitTokenMutation.isPending}
        />
      ) : null}
    </Stack>
  );
}
