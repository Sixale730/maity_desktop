// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/ExpeditionReward.test.tsx
// Versión desktop: sin MemoryRouter (Link de @/lib/router-compat), next/navigation mockeado;
// /avatar solo existe en la web → el link abre https://www.maity.cloud/avatar?vista=logros.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExpeditionReward } from './ExpeditionReward';
import { DEFAULT_ANIMAL } from '@maity/shared';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/planLinks', () => ({ openExternalUrl: vi.fn(), buildHandoffUrl: vi.fn() }));
vi.mock('@/features/avatar/components/AnimalPortrait', () => ({AnimalPortrait: ({design}: {design:{equipment?:string[]}}) => <span data-testid="preview">{design.equipment?.join(',') || 'básico'}</span>}));
afterEach(cleanup);
it('shows the saved avatar and sends equipment management to the avatar page', () => {
 const avatar = {full_config:{animal_avatar:{...DEFAULT_ANIMAL}}};
 const before = JSON.stringify(avatar);
 render(<ExpeditionReward avatar={avatar} xp={0} nodes={[]} reliable={false}/>);
 expect(screen.queryByRole('button',{name:'Probar cómo me queda'})).toBeNull();
 expect(JSON.stringify(avatar)).toBe(before);
 expect(screen.getByRole('link', {name: /Ver mis logros/}).getAttribute('href')).toBe('https://www.maity.cloud/avatar?vista=logros');
 expect(screen.getByTestId('preview').textContent).toBe('básico');
});
it('does not invent challenge progress when the route is unavailable', () => {
 render(<ExpeditionReward avatar={{}} xp={2525} nodes={[]} reliable={false}/>);
 expect(screen.getByText(/Conecta tu ruta/)).toBeTruthy();
 expect(screen.queryByText(/0 \/ 6/)).toBeNull();
});
it('references only gear images shipped in public/assets', () => {
 render(<ExpeditionReward avatar={{}} xp={0} nodes={[]} reliable={false}/>);
 expect(screen.getByRole('img', { name: 'Casco de expedición' }).getAttribute('src')).toBe('/assets/avatars/gear-helmet-v4.webp');
});
