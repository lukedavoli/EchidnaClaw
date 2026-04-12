// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';

describe('App', () => {
  it('renders the control plane shell', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /echidnaclaw control plane/i })).toBeInTheDocument();
    expect(screen.getByText(/step 4 workflows/i)).toBeInTheDocument();
    expect(screen.getByText(/local-minimal/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /developer startup, verification, packaging, and branch deployment policies are wired/i,
      ),
    ).toBeInTheDocument();
  });
});
