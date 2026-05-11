import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  testId?: string;
  className?: string;
  faded?: boolean;
};

export function CardShell({ children, testId, className = '', faded = false }: Props) {
  return (
    <article
      data-testid={testId}
      className={`min-h-[7rem] rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
        faded ? 'opacity-70' : ''
      } ${className}`}
    >
      {children}
    </article>
  );
}
