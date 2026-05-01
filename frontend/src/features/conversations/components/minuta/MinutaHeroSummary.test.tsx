import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MinutaHeroSummary } from './MinutaHeroSummary';

const baseMeta = {
  titulo: 'Reunion de prueba',
  fecha: '2026-05-01',
  duracion_min: 30,
  participantes: [],
};

describe('MinutaHeroSummary — render defensivo', () => {
  it('no crashea con temas=undefined (caso de conversaciones cortas)', () => {
    expect(() => {
      render(<MinutaHeroSummary meta={baseMeta} temas={undefined} />);
    }).not.toThrow();
    cleanup();
  });

  it('no crashea con temas=[]', () => {
    expect(() => {
      render(<MinutaHeroSummary meta={baseMeta} temas={[]} />);
    }).not.toThrow();
    cleanup();
  });

  it('no muestra "Temas cubiertos" cuando no hay temas', () => {
    const { queryByText } = render(<MinutaHeroSummary meta={baseMeta} temas={[]} />);
    expect(queryByText(/Temas cubiertos/i)).toBeNull();
    cleanup();
  });

  it('renderiza el titulo del meta siempre', () => {
    const { getByText } = render(<MinutaHeroSummary meta={baseMeta} temas={undefined} />);
    expect(getByText('Reunion de prueba')).toBeInTheDocument();
    cleanup();
  });

  it('renderiza el resumen del primer tema cuando hay datos', () => {
    const temas = [
      { nombre: 'Tema A', titulo: 'Tema A', resumen: 'Discusion de A' },
      { nombre: 'Tema B', titulo: 'Tema B', resumen: 'Discusion de B' },
    ];
    const { getByText } = render(<MinutaHeroSummary meta={baseMeta} temas={temas} />);
    expect(getByText('Discusion de A')).toBeInTheDocument();
    expect(getByText(/Tema A · Tema B/)).toBeInTheDocument();
    cleanup();
  });
});
