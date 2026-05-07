import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalysisStatusBanner } from './AnalysisStatusBanner';

describe('AnalysisStatusBanner', () => {
  it('renders nothing for idle phase', () => {
    const { container } = render(<AnalysisStatusBanner phase="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for completed phase (the rest of the page renders the analysis)', () => {
    const { container } = render(<AnalysisStatusBanner phase="completed" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for skipped phase', () => {
    const { container } = render(<AnalysisStatusBanner phase="skipped" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders polling spinner', () => {
    render(<AnalysisStatusBanner phase="polling" />);
    expect(screen.getByText(/Analizando conversación/i)).toBeInTheDocument();
  });

  it('renders stalled card with retry button', () => {
    const onRetry = vi.fn();
    render(<AnalysisStatusBanner phase="stalled" onRetry={onRetry} />);
    expect(screen.getByText(/Tarda más de lo normal/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders failed card with retry button', () => {
    const onRetry = vi.fn();
    render(<AnalysisStatusBanner phase="failed" onRetry={onRetry} />);
    expect(screen.getByText(/No se pudo completar el análisis/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('hides retry button when onRetry is not provided', () => {
    render(<AnalysisStatusBanner phase="failed" />);
    expect(screen.queryByRole('button', { name: /Reintentar/i })).not.toBeInTheDocument();
  });
});
