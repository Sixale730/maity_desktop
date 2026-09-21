import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { push, replace, openExternalUrl } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  openExternalUrl: vi.fn(() => Promise.resolve()),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/planLinks', () => ({ openExternalUrl }));

import { Link, resolveRoute, useNavigate, MAITY_WEB_ORIGIN } from './router-compat';

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  openExternalUrl.mockReset().mockResolvedValue(undefined);
});

describe('resolveRoute (web → desktop)', () => {
  it('keeps the historical aliases', () => {
    expect(resolveRoute('/dashboard')).toEqual({ internal: '/' });
    expect(resolveRoute('/gamified-dashboard-v2')).toEqual({ internal: '/' });
    expect(resolveRoute('/auth/callback')).toEqual({ internal: '/' });
    expect(resolveRoute('/registration')).toEqual({ internal: '/registration' });
    expect(resolveRoute('/billing/plans?checkout=pro')).toEqual({ internal: '/billing/plans?checkout=pro' });
    expect(resolveRoute('/agenda')).toEqual({ external: 'https://www.maity.cloud/agenda' });
  });

  it('maps the Spanish web routes to the desktop pages', () => {
    expect(resolveRoute('/conversaciones')).toEqual({ internal: '/conversations' });
    expect(resolveRoute('/conversaciones/abc-123')).toEqual({ internal: '/conversations?id=abc-123' });
    expect(resolveRoute('/notas')).toEqual({ internal: '/notes' });
    expect(resolveRoute('/configuracion')).toEqual({ internal: '/settings' });
  });

  it('sends web-only screens to maity.cloud keeping path and query', () => {
    expect(resolveRoute('/avatar')).toEqual({ external: `${MAITY_WEB_ORIGIN}/avatar` });
    expect(resolveRoute('/avatar?vista=logros')).toEqual({ external: `${MAITY_WEB_ORIGIN}/avatar?vista=logros` });
    expect(resolveRoute('/skills-arena')).toEqual({ external: `${MAITY_WEB_ORIGIN}/skills-arena` });
    expect(resolveRoute('/learning-path')).toEqual({ external: `${MAITY_WEB_ORIGIN}/learning-path` });
    expect(resolveRoute('/expedicion')).toEqual({ external: `${MAITY_WEB_ORIGIN}/expedicion` });
    // Un prefijo parecido NO es la misma ruta.
    expect(resolveRoute('/avatares')).toEqual({ internal: '/avatares' });
  });
});

describe('Link shim', () => {
  it('renders internal routes with the mapped desktop href', () => {
    render(<Link to="/conversaciones/one" title="t">Ver</Link>);
    expect(screen.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('/conversations?id=one');
  });

  it('opens web-only routes in the system browser instead of navigating the webview', () => {
    render(<Link to="/skills-arena" className="cta">Practicar</Link>);
    const link = screen.getByRole('link', { name: 'Practicar' });
    expect(link.getAttribute('href')).toBe(`${MAITY_WEB_ORIGIN}/skills-arena`);
    expect(link.className).toBe('cta');
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(openExternalUrl).toHaveBeenCalledWith(`${MAITY_WEB_ORIGIN}/skills-arena`);
  });
});

describe('useNavigate', () => {
  function Probe({ to }: { to: string }) {
    const navigate = useNavigate();
    return <button onClick={() => navigate(to)}>go</button>;
  }

  it('pushes mapped internal routes and opens external ones', () => {
    const view = render(<Probe to="/notas" />);
    fireEvent.click(screen.getByText('go'));
    expect(push).toHaveBeenCalledWith('/notes');
    view.unmount();
    render(<Probe to="/avatar" />);
    fireEvent.click(screen.getByText('go'));
    expect(openExternalUrl).toHaveBeenCalledWith(`${MAITY_WEB_ORIGIN}/avatar`);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
