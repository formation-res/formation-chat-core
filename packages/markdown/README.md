# Chat message Markdown

`@formation-chat-core/markdown` provides the shared `renderMarkdown(text)` function used by the
reference React UI, operator dashboard, and example widgets.

Message text supports CommonMark-style headings, emphasis, lists, blockquotes, links, tables, and
fenced or inline code. Ordinary newlines render as line breaks to suit conversational responses.

Connector and visitor text remains untrusted:

- raw HTML is escaped rather than executed;
- links accept relative URLs plus HTTP, HTTPS, and mailto destinations;
- rendered links open in a new tab with `noopener noreferrer`;
- Markdown images render only their alternative text, preventing message-controlled tracking
  requests.

The canonical message contract remains text. Markdown is a presentation behavior, so clients that
do not want it can render text parts directly or use the React UI's existing custom part renderer.
