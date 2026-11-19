// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoadmapNode } from '@campuslink/shared';
import i18n from '../../i18n/core';
import en from '../../i18n/en.json';
import { JourneyView } from './journey';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// jsdom has no matchMedia, and the preferences module reads it when it is imported.
vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } } as never);
});

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const node = (id: string, needsReview: boolean, prerequisites: string[] = []): RoadmapNode => ({
  id,
  title: `Step ${id}`,
  kind: 'skill',
  summary: 'A step in the path, long enough.',
  prerequisites,
  estimateHours: [2, 4],
  resources: [],
  proof: '',
  sources: [],
  needsReview,
});

async function render(showReview: boolean) {
  const host = document.createElement('main');
  document.body.append(host);
  const root = createRoot(host);
  const ui = (
    <JourneyView
      nodes={[node('a', false), node('b', true, ['a'])]}
      category="software"
      onOpen={() => undefined}
      showReview={showReview}
    />
  );
  const router = createMemoryRouter([{ path: '*', element: ui }]);
  await act(async () => root.render(<RouterProvider router={router} />));
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return host;
}

describe('the journey (prompt 3, U12, audit A12)', () => {
  it('never shows a student that a step needs review', async () => {
    const host = await render(false);
    expect(host.textContent).toContain('Step b');
    expect(host.textContent).not.toContain('Needs review');
  });

  it('shows it to the people who write and review paths', async () => {
    const host = await render(true);
    expect(host.textContent).toContain('Needs review');
  });
});
