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
        description="Create a new operator-managed agent with a name, a home time zone, and the reserved provisioning state that later steps will complete."
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
            await createAgentMutation.mutateAsync(values);
            notifications.show({
              color: 'teal',
              message: `${values.name} is now visible in the active roster.`,
              title: 'Agent created',
            });
            navigate('/agents');
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
