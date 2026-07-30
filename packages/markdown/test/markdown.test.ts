import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../src/index.js';

describe('renderMarkdown', () => {
  it('renders useful block and inline Markdown', () => {
    const html = renderMarkdown(
      '## Next steps\n\n- Choose **Settings**\n- Save `changes`\n\n[Read more](https://example.com/help)',
    );

    expect(html).toContain('<h2>Next steps</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>Settings</strong>');
    expect(html).toContain('<code>changes</code>');
    expect(html).toContain(
      '<a href="https://example.com/help" target="_blank" rel="noopener noreferrer">Read more</a>',
    );
  });

  it('renders ordinary line breaks without requiring two trailing spaces', () => {
    expect(renderMarkdown('First line\nSecond line')).toContain('First line<br>\nSecond line');
  });

  it('escapes raw HTML and blocks unsafe links', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))');

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href=');
  });

  it('does not embed remote images from message content', () => {
    const html = renderMarkdown('![tracking pixel](https://example.com/pixel.gif)');

    expect(html).not.toContain('<img');
    expect(html).toContain('tracking pixel');
  });
});
