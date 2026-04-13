import { Box, type BoxProps } from '@mantine/core';
import type { PropsWithChildren } from 'react';

type PageFrameProps = PropsWithChildren<BoxProps>;

export function PageFrame({ children, className, ...props }: PageFrameProps) {
  return (
    <Box
      {...props}
      className={['page-frame', className].filter(Boolean).join(' ')}
    >
      {children}
    </Box>
  );
}
