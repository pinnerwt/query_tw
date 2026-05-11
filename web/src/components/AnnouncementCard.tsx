import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { CardShell } from './CardShell';
import { useDismissedStore } from '../state/dismissedStore';
import type { Announcement } from '../types';

const SEVERITY_STYLES: Record<Announcement['severity'], { border: string; chip: string; label: string }> = {
  info:     { border: 'border-l-4 border-l-slate-400',  chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200', label: '公告' },
  warning:  { border: 'border-l-4 border-l-amber-500', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200', label: '注意' },
  critical: { border: 'border-l-4 border-l-rose-600',  chip: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-100',     label: '警告' },
};

type Props = {
  a: Announcement;
  dismissible?: boolean;
};

export function AnnouncementCard({ a, dismissible = true }: Props) {
  const dismiss = useDismissedStore((s) => s.dismiss);
  const styles = SEVERITY_STYLES[a.severity];
  return (
    <CardShell testId="announcement-card" className={styles.border}>
      <div className="flex items-start justify-between gap-2">
        <span className={`chip ${styles.chip}`}>{styles.label}</span>
        {dismissible && (
          <button
            aria-label="關閉公告"
            onClick={() => dismiss(a.id)}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            data-testid="dismiss-announcement"
          >
            ✕
          </button>
        )}
      </div>
      <div className="mt-2 text-sm leading-relaxed [&_a]:text-indigo-700 [&_a]:underline dark:[&_a]:text-indigo-300">
        <ReactMarkdown
          rehypePlugins={[rehypeSanitize]}
          components={{
            a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {a.body}
        </ReactMarkdown>
      </div>
    </CardShell>
  );
}
