import { Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

type PageHeaderProps = {
  actions?: ReactNode;
  description: string;
  title: string;
};

export function PageHeader({ actions, description, title }: PageHeaderProps) {
  return (
    <Group align="flex-start" justify="space-between" wrap="wrap">
      <Stack gap="xs">
        <h1 className="page-header__title">{title}</h1>
        <Text className="page-header__description">{description}</Text>
      </Stack>
      {actions ? <Group gap="sm">{actions}</Group> : null}
    </Group>
  );
}
