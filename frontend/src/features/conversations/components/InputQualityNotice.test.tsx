import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InputQualityNotice, readCalidadInsumo } from './InputQualityNotice';
import type { CalidadInsumo } from '../services/conversations.service';

const clean: CalidadInsumo = {
  duracion_total_min: 30,
  tramos_densos_min: 30,
  ratio_alucinacion: 0.01,
  palabras_descartadas: 0,
  nivel: 'alta',
};

describe('readCalidadInsumo', () => {
  it('devuelve null para filas sin la clave (anteriores a ago-2026) o payloads no-objeto', () => {
    expect(readCalidadInsumo(null)).toBeNull();
    expect(readCalidadInsumo({ calidad_global: { puntaje: 80 } })).toBeNull();
    expect(readCalidadInsumo({ calidad_insumo: 'x' })).toBeNull();
    expect(readCalidadInsumo({ calidad_insumo: { nivel: 'baja' } })).toBeNull();
  });

  it('normaliza el bloque 6.1 y defaultea nivel a alta', () => {
    const c = readCalidadInsumo({
      calidad_insumo: { duracion_total_min: 59.7, tramos_densos_min: 30.2, palabras_descartadas: 25 },
    });
    expect(c).toEqual({
      duracion_total_min: 59.7,
      tramos_densos_min: 30.2,
      ratio_alucinacion: 0,
      palabras_descartadas: 25,
      hablantes_detectados: undefined,
      confianza_atribucion: null,
      nivel: 'alta',
    });
  });
});

describe('InputQualityNotice', () => {
  it('no renderiza nada para una grabación limpia', () => {
    const { container } = render(<InputQualityNotice calidad={clean} />);
    expect(container.firstChild).toBeNull();
  });

  it('parcial: "se analizaron 30 min de 60 grabados"', () => {
    render(<InputQualityNotice calidad={{ ...clean, duracion_total_min: 59.7, tramos_densos_min: 30.2 }} />);
    expect(screen.getByText(/Se analizaron 30 min de conversación dentro de 60 min grabados/)).toBeInTheDocument();
    expect(screen.getByTestId('input-quality-notice')).toHaveAttribute('data-nivel', 'alta');
  });

  it('descartadas: menciona las palabras inventadas sobre ruido', () => {
    render(<InputQualityNotice calidad={{ ...clean, palabras_descartadas: 25 }} />);
    expect(screen.getByText(/Se descartaron 25 palabras/)).toBeInTheDocument();
    expect(screen.queryByText(/Se analizaron/)).not.toBeInTheDocument();
  });

  it('nivel baja: aviso ámbar con el porcentaje de ruido', () => {
    render(<InputQualityNotice calidad={{ ...clean, nivel: 'baja', ratio_alucinacion: 0.31 }} />);
    expect(screen.getByText(/\(31%\) parece ruido transcrito/)).toBeInTheDocument();
    expect(screen.getByTestId('input-quality-notice')).toHaveAttribute('data-nivel', 'baja');
  });
});
