import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconClockPause, IconPlugConnectedX } from '@tabler/icons-react';
import type { ReactNode } from 'react';

type ErrorPanelTone = 'danger' | 'info' | 'warning';

type ErrorPanelProps = {
  actionLabel?: string;
  description: ReactNode;
  onAction?: () => void;
  title: string;
  tone?: ErrorPanelTone;
  traceId?: string | null;
};

const toneIconMap = {
  danger: IconAlertTriangle,
  info: IconClockPause,
  warning: IconPlugConnectedX,
} as const;

const toneColorMap = {
  danger: 'red',
  info: 'blue',
  warning: 'orange',
} as const;

export function ErrorPanel({
  actionLabel,
  description,
  onAction,
  title,
  tone = 'danger',
  traceId,
}: ErrorPanelProps) {
  const Icon = toneIconMap[tone];

  return (
    <Alert color={toneColorMap[tone]} icon={<Icon size={18} />} radius="lg" variant="light">
      <Stack gap="sm">
        <Stack gap={2}>
          <Text fw={700}>{title}</Text>
          <Text>{description}</Text>
          {traceId ? (
            <Text c="dimmed" ff="monospace" size="sm">
              Trace ID: {traceId}
            </Text>
          ) : null}
        </Stack>
        {actionLabel && onAction ? (
          <Group>
            <Button onClick={onAction} variant="white">
              {actionLabel}
            </Button>
          </Group>
        ) : null}
      </Stack>
    </Alert>
  );
}
