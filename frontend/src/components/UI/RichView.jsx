import { sanitizeChatHtml } from '../../utils/chatHtml';

// Renders superadmin-authored rich text safely. Content is sanitized through the
// same DOMPurify allowlist used by chat (bold/italic/underline, lists, links,
// images). Plain-text (legacy, no tags) is shown with line breaks preserved.
const RichView = ({ html, className = '', style }) => {
  const s = (html || '').toString();
  if (!/[<&]/.test(s)) {
    return <div className={`whitespace-pre-wrap ${className}`} style={style}>{s}</div>;
  }
  return <div className={`bsx-richview ${className}`} style={style} dangerouslySetInnerHTML={{ __html: sanitizeChatHtml(s) }} />;
};

export default RichView;
