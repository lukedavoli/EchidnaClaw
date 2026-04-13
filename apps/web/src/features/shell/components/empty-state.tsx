import { Button, Paper, Stack, Text } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

type EmptyStateProps = {
  actionLabel?: string;
  actionTo?: string;
  description: string;
  title: string;
};

export function EmptyState({ actionLabel, actionTo, description, title }: EmptyStateProps) {
  return (
    <Paper className="shell-surface shell-surface--strong" p="xl" radius="xl" withBorder>
      <Stack gap="sm">
        <Text fw={700} size="xl">
          {title}
        </Text>
        <Text c="dimmed" maw={620}>
          {description}
        </Text>
        {actionLabel && actionTo ? (
          <Button
            component={Link}
            leftSection={<IconArrowRight size={16} />}
            to={actionTo}
            w="fit-content"
          >
            {actionLabel}
          </Button>
        ) : null}
      </Stack>
    </Paper>
  );
}
