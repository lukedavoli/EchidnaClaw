import { Button, Group, Modal, Stack, Text } from '@mantine/core';

type ArchiveAgentDialogProps = {
  agentName: string;
  loading: boolean;
  mode: 'archive' | 'restore';
  onClose: () => void;
  onConfirm: () => void;
  opened: boolean;
};

const copy = {
  archive: {
    confirmLabel: 'Archive agent',
    description:
      'This keeps the agent record available for analytics and later recovery while removing it from the active roster.',
    title: 'Archive this agent?',
  },
  restore: {
    confirmLabel: 'Restore agent',
    description:
      'This returns the agent to the active roster. Provisioning retry remains reserved until the backend lifecycle flow is available.',
    title: 'Restore this agent?',
  },
} as const;

export function ArchiveAgentDialog({
  agentName,
  loading,
  mode,
  onClose,
  onConfirm,
  opened,
}: ArchiveAgentDialogProps) {
  const content = copy[mode];

  return (
    <Modal onClose={onClose} opened={opened} title={content.title}>
      <Stack gap="lg">
        <Text>
          <strong>{agentName}</strong>
        </Text>
        <Text c="dimmed">{content.description}</Text>
        <Group justify="flex-end">
          <Button onClick={onClose} variant="default">
            Cancel
          </Button>
          <Button color={mode === 'archive' ? 'red' : 'teal'} loading={loading} onClick={onConfirm}>
            {content.confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
