import { Alert, Badge, Button, Card, Code, Group, List, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconBrandTelegram, IconRefresh } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import type { AdminTelegramProvisioningHandoff } from '@echidna-claw/contracts';

import type { ApiClientError } from '../../../lib/api/errors.js';
import { TelegramBotTokenForm } from './telegram-bot-token-form.js';

function stateLabel(state: AdminTelegramProvisioningHandoff['state']) {
  switch (state) {
    case 'pending_operator_action':
      return 'Needs token';
    case 'verifying_token':
      return 'Verifying';
    case 'awaiting_operator_binding':
      return 'Awaiting bind';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
  }
}

type TelegramProvisioningPanelProps = {
  handoff: AdminTelegramProvisioningHandoff;
  onRetry: () => Promise<void>;
  onSubmitToken: (values: { botToken: string }) => Promise<void>;
  retrying: boolean;
  submitError: ApiClientError | null;
  submittingToken: boolean;
};

export function TelegramProvisioningPanel({
  handoff,
  onRetry,
  onSubmitToken,
  retrying,
  submitError,
  submittingToken,
}: TelegramProvisioningPanelProps) {
  return (
    <Card
      className="shell-surface shell-surface--strong"
      padding="xl"
      radius="xl"
      withBorder
    >
      <Stack gap="lg">
        <Group justify="space-between">
          <Stack gap={2}>
            <Text fw={700} size="lg">
              Telegram handoff
            </Text>
            <Text c="dimmed" size="sm">
              Attempt {handoff.attemptNumber} for channel {handoff.channelId}
            </Text>
          </Stack>
          <Badge color={handoff.state === 'failed' ? 'red' : 'blue'} radius="sm" variant="light">
            {stateLabel(handoff.state)}
          </Badge>
        </Group>

        {handoff.botHandle || handoff.botDisplayName ? (
          <Alert
            color="blue"
            icon={<IconBrandTelegram size={18} />}
            radius="lg"
            variant="light"
          >
            <Stack gap={4}>
              {handoff.botDisplayName ? <Text fw={600}>{handoff.botDisplayName}</Text> : null}
              {handoff.botHandle ? <Text size="sm">@{handoff.botHandle}</Text> : null}
            </Stack>
          </Alert>
        ) : null}

        {handoff.lastErrorMessage ? (
          <Alert color="red" icon={<IconAlertTriangle size={18} />} radius="lg" variant="light">
            <Stack gap={4}>
              <Text fw={600}>{handoff.lastErrorMessage}</Text>
              {handoff.lastErrorCode ? (
                <Text ff="monospace" size="sm">
                  {handoff.lastErrorCode}
                </Text>
              ) : null}
            </Stack>
          </Alert>
        ) : null}

        <List size="sm" spacing="xs">
          {handoff.instructions.map((instruction) => (
            <List.Item key={instruction}>{instruction}</List.Item>
          ))}
        </List>

        {handoff.state === 'awaiting_operator_binding' ? (
          <Stack gap="sm">
            {handoff.bootstrapCode ? (
              <Stack gap={4}>
                <Text fw={600}>Bootstrap code</Text>
                <Code block>{handoff.bootstrapCode}</Code>
              </Stack>
            ) : null}

            {handoff.bootstrapExpiresAt ? (
              <Text c="dimmed" size="sm">
                Expires at {new Date(handoff.bootstrapExpiresAt).toLocaleString()}.
              </Text>
            ) : null}

            <Group>
              {handoff.openTelegramUrl ? (
                <Button
                  component="a"
                  href={handoff.openTelegramUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open Telegram
                </Button>
              ) : null}
              <Button
                leftSection={<IconRefresh size={16} />}
                loading={retrying}
                onClick={() => {
                  void onRetry();
                }}
                variant="default"
              >
                Retry provisioning
              </Button>
            </Group>
          </Stack>
        ) : null}

        {handoff.state === 'completed' ? (
          <Group>
            {handoff.openTelegramUrl ? (
              <Button
                component="a"
                href={handoff.openTelegramUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open bot
              </Button>
            ) : null}
            <Button component={Link} to="/agents" variant="default">
              Back to agents
            </Button>
          </Group>
        ) : null}

        {(handoff.state === 'pending_operator_action' || handoff.state === 'failed') && (
          <TelegramBotTokenForm
            error={submitError}
            label={handoff.requiresBotToken ? 'Submit Telegram bot token' : 'Replace Telegram bot token'}
            onSubmit={onSubmitToken}
            submitting={submittingToken}
          />
        )}

        {handoff.state === 'failed' ? (
          <Group justify="flex-end">
            <Button
              leftSection={<IconRefresh size={16} />}
              loading={retrying}
              onClick={() => {
                void onRetry();
              }}
              variant="default"
            >
              Retry provisioning
            </Button>
          </Group>
        ) : null}
      </Stack>
    </Card>
  );
}
