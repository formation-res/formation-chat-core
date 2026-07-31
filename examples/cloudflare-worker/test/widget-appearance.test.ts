import { describe, expect, it } from 'vitest';

import { widgetThemes, resolveWidgetAppearance } from '../site/widget-appearance.js';

describe('widget appearance', () => {
  it('keeps one shared light palette while retaining each style accent', () => {
    const appearances = widgetThemes.map((theme) => resolveWidgetAppearance(theme, 'light'));

    expect(new Set(appearances.map(({ paper }) => paper))).toEqual(new Set(['#f7f6f1']));
    expect(new Set(appearances.map(({ surface }) => surface))).toEqual(new Set(['#ffffff']));
    expect(new Set(appearances.map(({ accent }) => accent)).size).toBe(widgetThemes.length);
  });

  it('derives a complete, readable dark palette from every widget style', () => {
    const appearances = widgetThemes.map((theme) => resolveWidgetAppearance(theme, 'dark'));

    expect(new Set(appearances.map(({ paper }) => paper)).size).toBe(widgetThemes.length);
    expect(new Set(appearances.map(({ surface }) => surface)).size).toBe(widgetThemes.length);
    expect(new Set(appearances.map(({ dark }) => dark)).size).toBe(widgetThemes.length);
    for (const appearance of appearances) {
      expect(contrast(appearance.ink, appearance.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(appearance.ink, appearance.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(appearance.muted, appearance.paper)).toBeGreaterThanOrEqual(4.5);
      expect(appearance.sendInk).toBe('#ffffff');
      expect(contrast(appearance.sendInk, appearance.send)).toBeGreaterThanOrEqual(4.5);
      expect(appearance.panelLine).not.toBe('transparent');
      expect(appearance.panelInset).toBe('transparent');
    }
  });
});

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)
    ?.map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const [red, green, blue] = channels ?? [];
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Expected a hex color, received ${color}`);
  }
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
