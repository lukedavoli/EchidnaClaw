import { Button } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

type RefreshButtonProps = {
  onClick?: () => void;
  refreshing?: boolean;
};

export function RefreshButton({ onClick, refreshing = false }: RefreshButtonProps) {
  return (
    <Button
      leftSection={<IconRefresh size={16} />}
      loading={refreshing}
      onClick={onClick}
      variant="default"
    >
      Refresh
    </Button>
  );
}
