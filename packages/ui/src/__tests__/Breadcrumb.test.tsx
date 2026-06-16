import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), run: vi.fn() } }));

import { Breadcrumb } from '../Breadcrumb.js';
import type { BreadcrumbItem } from '@pi-tree/core/types';

const makeItem = (overrides?: Partial<BreadcrumbItem>): BreadcrumbItem => ({
  nodeId: 'node-1',
  label: 'Test Topic',
  ...overrides,
});

const defaultProps = () => ({
  items: [] as BreadcrumbItem[],
  onNavigate: vi.fn(),
  bookTitle: 'My Book',
  isScoped: false,
});

describe('Breadcrumb', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders book title as static text when not scoped', () => {
    render(<Breadcrumb {...defaultProps()} isScoped={false} />);
    const el = screen.getByText('My Book');
    expect(el.tagName).toBe('SPAN');
  });

  it('renders book title as clickable root when scoped', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb {...defaultProps()} isScoped={true} onNavigate={onNavigate} />);
    const btn = screen.getByText('My Book');
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(onNavigate).toHaveBeenCalledWith('');
  });

  it('renders breadcrumb segments', () => {
    render(
      <Breadcrumb
        {...defaultProps()}
        items={[makeItem({ nodeId: 'n1', label: 'Chapter 1' }), makeItem({ nodeId: 'n2', label: 'Section A' })]}
      />,
    );
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Section A')).toBeInTheDocument();
  });

  it('last item is not clickable', () => {
    render(
      <Breadcrumb
        {...defaultProps()}
        items={[makeItem({ nodeId: 'n1', label: 'First' }), makeItem({ nodeId: 'n2', label: 'Last' })]}
      />,
    );
    const last = screen.getByText('Last');
    expect(last.tagName).toBe('SPAN');
  });

  it('intermediate items are clickable and call onNavigate', () => {
    const onNavigate = vi.fn();
    render(
      <Breadcrumb
        {...defaultProps()}
        onNavigate={onNavigate}
        items={[makeItem({ nodeId: 'n1', label: 'First' }), makeItem({ nodeId: 'n2', label: 'Last' })]}
      />,
    );
    const first = screen.getByText('First');
    expect(first.tagName).toBe('BUTTON');
    fireEvent.click(first);
    expect(onNavigate).toHaveBeenCalledWith('n1');
  });

  it('collapses to last 2 items with ellipsis for 4 items', () => {
    render(
      <Breadcrumb
        {...defaultProps()}
        items={[
          makeItem({ nodeId: 'n1', label: 'A' }),
          makeItem({ nodeId: 'n2', label: 'B' }),
          makeItem({ nodeId: 'n3', label: 'C' }),
          makeItem({ nodeId: 'n4', label: 'D' }),
        ]}
      />,
    );
    expect(screen.getByText('…')).toBeInTheDocument();
    // Only last 2 visible
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    // First 2 collapsed
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });

  it('ellipsis tooltip shows collapsed labels', () => {
    render(
      <Breadcrumb
        {...defaultProps()}
        items={[
          makeItem({ nodeId: 'n1', label: 'Alpha' }),
          makeItem({ nodeId: 'n2', label: 'Beta' }),
          makeItem({ nodeId: 'n3', label: 'Gamma' }),
          makeItem({ nodeId: 'n4', label: 'Delta' }),
        ]}
      />,
    );
    const ellipsis = screen.getByText('…');
    expect(ellipsis).toHaveAttribute('title', 'Alpha / Beta');
  });

  it('truncates long labels', () => {
    const longLabel = 'A'.repeat(40);
    render(
      <Breadcrumb
        {...defaultProps()}
        items={[makeItem({ nodeId: 'n1', label: longLabel })]}
      />,
    );
    // Last item uses maxLen 30 → 30 chars + "…"
    const truncated = 'A'.repeat(30) + '…';
    expect(screen.getByText(truncated)).toBeInTheDocument();
  });

  it('renders session label when provided', () => {
    render(<Breadcrumb {...defaultProps()} sessionLabel="Reading Session" />);
    expect(screen.getByText('Reading Session')).toBeInTheDocument();
  });

  it('renders panel toggle buttons', () => {
    const toggle = { id: 'toc', icon: '📚', label: 'Table of Contents', active: true, onClick: vi.fn() };
    render(<Breadcrumb {...defaultProps()} panelToggles={[toggle]} />);
    const btn = screen.getByLabelText('Table of Contents');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveClass('pit-active');
  });

  it('panel toggle click calls onClick', () => {
    const onClick = vi.fn();
    const toggle = { id: 'toc', icon: '📚', label: 'TOC', active: false, onClick };
    render(<Breadcrumb {...defaultProps()} panelToggles={[toggle]} />);
    fireEvent.click(screen.getByLabelText('TOC'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
