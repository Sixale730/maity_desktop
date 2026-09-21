// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/PerformanceSummary.test.tsx
// Versión desktop: sin MemoryRouter (Link de @/lib/router-compat = next/link), next/navigation
// mockeado; los links a /conversaciones se sirven como /conversations.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceSummary } from './PerformanceSummary';
import type { OmiConversationListItem } from '@/features/omi/services/omi.service';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/planLinks', () => ({ openExternalUrl: vi.fn() }));
afterEach(cleanup);
const session = { num:1,fecha:'16 sep',tipo:'Conversación',global:34,claridad:30,estructura:40,empatia:40,objetivo:40,muletillas:0 };
const conversation = (raw: Record<string, unknown>): OmiConversationListItem => ({ id:'one',user_id:'u',created_at:'2026-09-16',title:'Sesión',overview:'',emoji:null,category:null,source:null,words_count:30,duration_seconds:60,communication_feedback:null,communication_feedback_v4:raw });
const feedback = { calidad_global: { puntaje:70, componentes:{ claridad:80,estructura:70,persuasion:40,proposito:80 }, mejorar:'Persuasión',mejorar_hint:'Explica el valor de tu propuesta.' } };
describe('PerformanceSummary', () => {
 it('does not fabricate scores when there are no evaluations', () => {
  render(<PerformanceSummary radar={[]} sessions={[]}/>);
  expect(screen.getByText(/Aún no hay conversaciones/)).toBeTruthy();
  expect(screen.queryByText(/100/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Ver mis conversaciones' }).getAttribute('href')).toBe('/conversations');
 });
 it('does not claim a trend from a single session', () => {
  render(<PerformanceSummary radar={[{dim:'Claridad',s1:30,s6:30}]} sessions={[session]}/>);
  expect(screen.getByText(/Una evaluación disponible/)).toBeTruthy();
  expect(screen.queryByText(/Practica/)).toBeNull();
 });
 it('shows a signed decrease and its comparison window', () => {
  render(<PerformanceSummary radar={[]} sessions={[session,{...session,global:63,fecha:'10 sep'}]}/>);
  expect(screen.getByText(/-29 puntos frente a 63/)).toBeTruthy();
  expect(screen.getByText(/no demuestra por sí sola una tendencia/)).toBeTruthy();
 });
 it('uses the V4 persuasion recommendation instead of prescribing vocabulary from the radar alias', () => {
  render(<PerformanceSummary radar={[{dim:'Vocabulario',s1:40,s6:40}]} sessions={[session]} conversations={[conversation(feedback)]}/>);
  expect(screen.getByText('Persuasión:')).toBeTruthy();
  expect(screen.getByText(/Explica el valor/)).toBeTruthy();
  expect(screen.queryByText(/términos ambiguos/)).toBeNull();
 });
 it('does not infer a weakness from unmeasured zero scores or a non-applicable recommendation', () => {
  render(<PerformanceSummary radar={[{dim:'Empatía',s1:0,s6:0}]} sessions={[session]} conversations={[conversation({...feedback,recording_mode:'presentation',calidad_global:{...feedback.calidad_global,mejorar:'Empatía',mejorar_hint:'Resume lo que escuchaste.'}})]}/>);
  expect(screen.queryByText(/Resume lo que escuchaste/)).toBeNull();
  expect(screen.queryByText('Empatía:')).toBeNull();
 });
 it('omits advice when measured data has no recommendation', () => {
  render(<PerformanceSummary radar={[{dim:'Empatía',s1:0,s6:0}]} sessions={[session]} conversations={[conversation({calidad_global:{puntaje:70,componentes:{claridad:80}}})]}/>);
  expect(screen.queryByText(/Practica/)).toBeNull();
  expect(screen.queryByText('Empatía:')).toBeNull();
 });
});
