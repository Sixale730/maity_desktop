import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisSkippedCard } from './AnalysisSkippedCard';
import type { AnalysisSkipped } from '../services/conversations.service';

describe('AnalysisSkippedCard', () => {
  it('insufficient_user_words: muestra el mínimo real y las palabras del usuario', () => {
    const marker: AnalysisSkipped = {
      status: 'skipped',
      reason: 'insufficient_user_words',
      user_words: 42,
      min_required: 100,
      speakers: 2,
    };
    render(<AnalysisSkippedCard marker={marker} />);
    expect(screen.getByText(/Conversación muy corta para analizar/)).toBeInTheDocument();
    expect(screen.getByText(/al menos 100 palabras tuyas/)).toBeInTheDocument();
    expect(screen.getByText(/tiene 42 palabras tuyas/)).toBeInTheDocument();
    expect(screen.queryByText(/nadie más hablando/)).not.toBeInTheDocument();
    expect(screen.getByText(/no consumió tu cuota/)).toBeInTheDocument();
  });

  it('insufficient_user_words sin min_required: no inventa el umbral (ni el 15 viejo)', () => {
    const marker: AnalysisSkipped = { status: 'skipped', reason: 'insufficient_user_words', user_words: 9 };
    const { container } = render(<AnalysisSkippedCard marker={marker} />);
    expect(screen.getByText(/tiene 9 palabras tuyas, por debajo del mínimo/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/15/);
    expect(container.textContent).not.toMatch(/undefined/);
  });

  it('insufficient_user_words con un solo hablante: avisa que no hubo interlocutor', () => {
    const marker: AnalysisSkipped = {
      status: 'skipped',
      reason: 'insufficient_user_words',
      user_words: 30,
      min_required: 100,
      speakers: 1,
    };
    render(<AnalysisSkippedCard marker={marker} />);
    expect(screen.getByText(/no se detectó a nadie más hablando/)).toBeInTheDocument();
  });

  it('no_evaluable_speech: habla de la duración grabada y de las palabras descartadas, no de "muy corta"', () => {
    // Caso real del piloto: 60 min grabados, 180 palabras, ninguna conversación.
    const marker: AnalysisSkipped = {
      status: 'skipped',
      reason: 'no_evaluable_speech',
      user_words: 180,
      min_required: 100,
      speakers: 1,
      metrics: {
        duracion_total_min: 59.7,
        tramos_densos_min: 0,
        tramos: [],
        ratio_alucinacion: 0.35,
        palabras_totales: 180,
        palabras_descartadas: 63,
        palabras_usuario_evaluadas: 0,
        hablantes_etiquetados: 1,
        idioma_dominante: 'en',
      },
    };
    const { container } = render(<AnalysisSkippedCard marker={marker} />);
    expect(screen.getByText(/No se encontró una conversación en esta grabación/)).toBeInTheDocument();
    expect(screen.getByText(/Grabaste 60 min/)).toBeInTheDocument();
    expect(screen.getByText(/Se descartaron 63 palabras/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/muy corta/);
    expect(container.textContent).not.toMatch(/mínimo requerido/);
  });

  it('no_evaluable_speech sin metrics: omite la cifra de minutos y las descartadas', () => {
    const marker: AnalysisSkipped = { status: 'skipped', reason: 'no_evaluable_speech' };
    const { container } = render(<AnalysisSkippedCard marker={marker} />);
    expect(screen.getByText(/No se encontró una conversación/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Grabaste/);
    expect(container.textContent).not.toMatch(/descartaron/);
  });

  it('all_providers_failed (marcador legacy): fallo de proveedor, sin afirmar nada sobre la cuota', () => {
    const marker: AnalysisSkipped = { status: 'skipped', reason: 'all_providers_failed' };
    const { container } = render(<AnalysisSkippedCard marker={marker} />);
    expect(screen.getByText(/No se pudo completar el análisis/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/cuota/);
    expect(container.textContent).toMatch(/minuta sigue disponible/i);
  });

  it('reason desconocido: texto genérico sin cifras', () => {
    const marker: AnalysisSkipped = { status: 'skipped', reason: 'something_new', user_words: 500 };
    const { container } = render(<AnalysisSkippedCard marker={marker} />);
    expect(screen.getByText(/Esta grabación se dejó sin evaluar/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/500/);
    expect(screen.getByTestId('analysis-skipped-card')).toHaveAttribute('data-reason', 'something_new');
  });
});
