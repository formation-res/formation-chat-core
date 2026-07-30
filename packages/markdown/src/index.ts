import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const validateMarkdownItLink = markdown.validateLink.bind(markdown);
markdown.validateLink = (value) => {
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(value)?.[0].toLowerCase();
  return (
    validateMarkdownItLink(value) &&
    (scheme === undefined || scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:')
  );
};

markdown.renderer.rules.link_open = (tokens, index, options, _environment, renderer) => {
  tokens[index]?.attrSet('target', '_blank');
  tokens[index]?.attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index]?.content ?? '');

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}
