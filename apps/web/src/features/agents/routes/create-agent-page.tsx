import { Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiClientError, isApiClientError } from '../../../lib/api/errors.js';
import { PageHeader } from '../../shell/components/page-header.js';
import { useCreateAgentMutation } from '../hooks.js';
import { CreateAgentForm } from '../components/create-agent-form.js';

export function CreateAgentPage() {
  const navigate = useNavigate();
  const createAgentMutation = useCreateAgentMutation();
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);

  return (
    <Stack gap="xl">
      <PageHeader
        description="Create a new operator-managed agent from the shared factory-default profile. Time zone is optional and acts as an override."
        title="Create agent"
      />

      <CreateAgentForm
        error={submitError}
        onCancel={() => {
          navigate('/agents');
        }}
        onSubmit={async (values) => {
          setSubmitError(null);

          try {
            const created = await createAgentMutation.mutateAsync(values);
            notifications.show({
              color: 'teal',
              message: `${values.name} is ready for Telegram bot setup.`,
              title: 'Agent created',
            });
            navigate(`/agents/${created.agent.id}`);
          } catch (error) {
            if (isApiClientError(error)) {
              setSubmitError(error);
              return;
            }

            setSubmitError(
              new ApiClientError({
                code: 'unexpected_error',
                kind: 'network',
                message: 'The create-agent flow failed unexpectedly.',
              }),
            );
          }
        }}
        submitting={createAgentMutation.isPending}
      />
    </Stack>
  );
}
