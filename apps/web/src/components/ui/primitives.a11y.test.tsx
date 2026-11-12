// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/core';
import en from '../../i18n/en.json';
import { Button } from './button';
import { ListRow, ListSection } from './list-row';
import { PageHeader } from './page-header';
import { Toolbar } from './toolbar';
import { EmptyState, Chip } from './misc';
import { Kbd, SkeletonRow } from './skeletons';
import { ActionCard } from './action-card';
import { PersonCard } from './person-card';
import { Countdown } from './countdown';
import { StepTrack } from './step-track';
import { ScoreRing } from './score-ring';
import { Timeline } from './timeline';
import { Input } from './field';

/**
 * ADR 0015's primitives, each rendered as the app renders it (inside a router) and checked by axe
 * for names, roles, list structure and ARIA. Colour contrast is the palette tests' job (jsdom has
 * no layout); the end-to-end axe runs cover real screens.
 */
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

async function render(ui: ReactNode) {
  const host = document.createElement('main');
  document.body.append(host);
  const root = createRoot(host);
  const router = createMemoryRouter([{ path: '*', element: ui }]);
  await act(async () => root.render(<RouterProvider router={router} />));
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return host;
}

async function violations(host: HTMLElement) {
  const result = await axe.run(host, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const soon = new Date(Date.now() + 3 * 60_000).toISOString();

const SPECIMENS: Record<string, ReactNode> = {
  Button: (
    <div>
      <Button variant="primary">Register</Button>
      <Button variant="secondary" size="sm">
        Not now
      </Button>
      <Button variant="tertiary" size="lg">
        See all
      </Button>
      <Button variant="danger" loading>
        Withdraw
      </Button>
    </div>
  ),
  ListSection: (
    <ListSection title="Coming up" action={<Button variant="tertiary">See all</Button>}>
      <ListRow title="Mock interview with Priya (demo)" meta="Tomorrow, 4:00 pm" to="/sessions/1" />
      <ListRow title="Resume review" meta="Friday" onClick={() => undefined} />
      <ListRow
        title="Nimbus Labs drive"
        meta="Closes Monday"
        trailing={<Button size="sm">Register</Button>}
      />
    </ListSection>
  ),
  PageHeader: (
    <PageHeader
      title="Placements"
      subtitle="3 drives you can register for"
      about={<p>Drives your college runs.</p>}
      overflow={[{ label: 'History', to: '/history' }]}
      primary={<Button variant="primary">Register</Button>}
    />
  ),
  Toolbar: (
    <Toolbar
      search={<Input aria-label="Search paths" placeholder="Search" />}
      filters={
        <>
          <Chip pressed>CSE</Chip>
          <Chip pressed={false}>ECE</Chip>
        </>
      }
      activeFilters={1}
    />
  ),
  EmptyState: (
    <EmptyState
      title="No sessions yet"
      preview={<SkeletonRow />}
      action={<Button variant="primary">Find a senior</Button>}
    >
      Book one with a senior and it shows here.
    </EmptyState>
  ),
  ActionCard: (
    <ActionCard
      kicker="Next session"
      title="Mock interview with Priya (demo)"
      meta="Google Meet · 30 min"
      deadline={<Countdown at={soon} kind="starts" />}
      action={<Button variant="primary">Join</Button>}
    />
  ),
  PersonCard: (
    <PersonCard
      name="Priya Raman (demo)"
      role="Data Analyst at Kestrel Analytics"
      batch="Batch of 2021 · CSE"
      reason="Same branch, replies within a day"
      to="/people/1"
      action={<Button size="sm">Follow</Button>}
    />
  ),
  StepTrack: (
    <StepTrack
      label="Your path"
      onOpen={() => undefined}
      phases={[
        {
          name: 'Foundations',
          steps: [
            { id: 'a', title: 'Programming basics', state: 'done', meta: 'About 2 weeks' },
            { id: 'b', title: 'Arrays and hashing', state: 'next', meta: 'About 1–2 weeks' },
          ],
        },
        { name: 'Core skills', steps: [{ id: 'c', title: 'Trees and graphs', state: 'upcoming' }] },
      ]}
    />
  ),
  ScoreRing: <ScoreRing score={48} label="Placement readiness" caption="of 100" delta="+6 this week" />,
  Timeline: (
    <Timeline
      label="Rounds"
      items={[
        { id: '1', time: 'Mon 10 Nov', title: 'Online test', state: 'past' },
        { id: '2', time: 'Wed 12 Nov', title: 'Technical interview', state: 'current' },
        { id: '3', time: 'Fri 14 Nov', title: 'HR interview', state: 'future' },
      ]}
    />
  ),
  Kbd: (
    <p>
      Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> to search.
    </p>
  ),
};

describe('primitives are accessible (ADR 0015)', () => {
  it.each(Object.entries(SPECIMENS))('%s has no axe violations', async (_, ui) => {
    const host = await render(ui);
    expect(await violations(host)).toEqual([]);
  });

  it('a loading button keeps its label (and so its width) and says it is busy', async () => {
    const host = await render(
      <Button variant="primary" loading>
        Register for the drive
      </Button>,
    );
    const button = host.querySelector('button');
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.textContent).toContain('Register for the drive');
  });

  it('a list row link covers the row and its trailing action stays separately reachable', async () => {
    const host = await render(
      <ListSection>
        <ListRow title="Nimbus Labs" to="/drives/1" trailing={<Button size="sm">Register</Button>} />
      </ListSection>,
    );
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/drives/1');
    expect(host.querySelectorAll('li button')).toHaveLength(1);
  });

  it('the step track is an ordered list numbered across phases, with each state spoken', async () => {
    const host = await render(SPECIMENS.StepTrack);
    const lists = host.querySelectorAll('ol');
    expect(lists[1]?.getAttribute('start')).toBe('3');
    expect(host.textContent).toContain('Done.');
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('Arrays and hashing');
  });

  it('a countdown is not a live region and carries the exact time in its label', async () => {
    const host = await render(<Countdown at={soon} kind="starts" />);
    const time = host.querySelector('time');
    expect(time?.closest('[aria-live]')).toBeNull();
    expect(time?.textContent).toMatch(/^Starts in \d+ minutes?$/);
    expect(time?.getAttribute('aria-label')).toContain(',');
  });
});
