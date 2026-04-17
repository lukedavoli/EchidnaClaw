import type { AnalyticsWindow } from '@echidna-claw/contracts';
import { Select } from '@mantine/core';

import { analyticsWindowOptions } from '../models.js';

type AnalyticsWindowControlProps = {
  onChange: (window: AnalyticsWindow) => void;
  value: AnalyticsWindow;
};

export function AnalyticsWindowControl({ onChange, value }: AnalyticsWindowControlProps) {
  return (
    <Select
      allowDeselect={false}
      aria-label="Analytics window"
      data={analyticsWindowOptions}
      label="Window"
      onChange={(nextValue) => {
        if (nextValue) {
          onChange(nextValue as AnalyticsWindow);
        }
      }}
      value={value}
      w={160}
    />
  );
}
