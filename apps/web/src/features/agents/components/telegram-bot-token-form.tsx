import { Alert, Button, Group, PasswordInput, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useState } from 'react';
import { z } from 'zod';

import type { ApiClientError } from '../../../lib/api/errors.js';

const tokenSchema = z.object({
  botToken: z.string().trim().min(1, 'A Telegram bot token is required.'),
});

type TelegramBotTokenFormProps = {
  error: ApiClientError | null;
  label: string;
  onSubmit: (values: { botToken: string }) => Promise<void>;
  submitting: boolean;
};

export function TelegramBotTokenForm({
  error,
  label,
  onSubmit,
  submitting,
}: TelegramBotTokenFormProps) {
  const [botToken, setBotToken] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = tokenSchema.safeParse({ botToken });
    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.botToken?.[0] ?? null);
      return;
    }

    setFieldError(null);
    await onSubmit(parsed.data);
    setBotToken('');
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="md">
      <Stack gap={4}>
        <Text fw={600}>{label}</Text>
        <Text c="dimmed" size="sm">
          The token is submitted directly to the API for immediate verification and is not stored
          in browser state after submit.
        </Text>
      </Stack>

      <PasswordInput
        autoComplete="off"
        error={fieldError}
        label="Bot token"
        onChange={(event) => {
          setBotToken(event.currentTarget.value);
        }}
        placeholder="123456:telegram-bot-token"
        value={botToken}
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
          <Button loading={submitting} type="submit">
            Verify token
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
