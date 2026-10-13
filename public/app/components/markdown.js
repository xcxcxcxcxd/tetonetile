import { marked } from 'marked';

// Knowledge articles are our own repository files (trusted content). Links of the form
// kb:article-id open another article; /paths navigate inside the app.
marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md) {
  return marked.parse(String(md || ''));
}
