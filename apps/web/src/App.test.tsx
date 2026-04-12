// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';

describe('App', () => {
  it('renders the control plane shell', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /echidnaclaw control plane/i })).toBeInTheDocument();
    expect(screen.getByText(/foundation scaffolding complete/i)).toBeInTheDocument();
  });
});
