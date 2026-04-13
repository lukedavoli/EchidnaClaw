import { Alert, Button, Card, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useState } from 'react';
import { z } from 'zod';

import type { ApiClientError } from '../../../lib/api/errors.js';

const createAgentFormSchema = z.object({
  name: z.string().trim().min(1, 'A name is required.'),
  timeZone: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

type FormState = {
  name: string;
  timeZone: string;
};

type FormValues = z.infer<typeof createAgentFormSchema>;

type CreateAgentFormProps = {
  error: ApiClientError | null;
  onCancel: () => void;
  onSubmit: (values: FormValues) => Promise<void>;
  submitting: boolean;
};

export function CreateAgentForm({ error, onCancel, onSubmit, submitting }: CreateAgentFormProps) {
  const [values, setValues] = useState<FormState>({
    name: '',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = createAgentFormSchema.safeParse(values);

    if (!parsed.success) {
      const formatted = parsed.error.flatten().fieldErrors;
      const nextErrors: Partial<Record<keyof FormState, string>> = {};

      if (formatted.name?.[0]) {
        nextErrors.name = formatted.name[0];
      }

      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    await onSubmit(parsed.data);
  }

  return (
    <Card
      className="shell-surface shell-surface--strong"
      component="form"
      onSubmit={handleSubmit}
      padding="xl"
      radius="xl"
      withBorder
    >
      <Stack gap="lg">
        <Stack gap="xs">
          <Text fw={700} size="lg">
            New agent
          </Text>
          <Text c="dimmed">
            New agents enter the registry immediately with a placeholder Telegram channel and a
            pending provisioning state.
          </Text>
        </Stack>

        <TextInput
          autoFocus
          description="Use a short operator-facing name."
          error={fieldErrors.name}
          label="Name"
          name="name"
          onChange={(event) => {
            const nextName = event.currentTarget.value;
            setValues((current) => ({ ...current, name: nextName }));
          }}
          placeholder="Ops Follow-up Agent"
          value={values.name}
        />

        <TextInput
          description="Optional override. Leave blank to use the shared factory-default time zone."
          error={fieldErrors.timeZone}
          label="Time zone"
          name="timeZone"
          onChange={(event) => {
            const nextTimeZone = event.currentTarget.value;
            setValues((current) => ({ ...current, timeZone: nextTimeZone }));
          }}
          placeholder="Australia/Sydney"
          value={values.timeZone}
        />

        {error ? (
          <Alert color="red" icon={<IconAlertTriangle size={18} />} radius="lg" variant="light">
            <Stack gap={4}>
              <Text fw={600}>{error.message}</Text>
              {error.traceId ? (
                <Text ff="monospace" size="sm">
                  Trace ID: {error.traceId}
                </Text>
              ) : null}
            </Stack>
          </Alert>
        ) : null}

        <Group justify="flex-end">
          <Button onClick={onCancel} type="button" variant="default">
            Cancel
          </Button>
          <Button loading={submitting} type="submit">
            Create agent
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
