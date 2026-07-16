import type { SVGProps } from 'react';

export type IconName =
  | 'activity'
  | 'alert'
  | 'arrow-left'
  | 'chevron'
  | 'conversation'
  | 'copy'
  | 'handoff'
  | 'moon'
  | 'refresh'
  | 'runs'
  | 'search'
  | 'sun';

const paths: Record<IconName, React.ReactNode> = {
  activity: (
    <>
      <path d="M4 12h3l2-7 4 14 2-7h5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 19h18.4L12 3Z" />
      <path d="M12 9v4m0 3h.01" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="m15 18-6-6 6-6" />
    </>
  ),
  chevron: (
    <>
      <path d="m9 18 6-6-6-6" />
    </>
  ),
  conversation: (
    <>
      <path d="M4 5h16v11H8l-4 4V5Z" />
      <path d="M8 9h8m-8 3h5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  handoff: (
    <>
      <path d="M8 12h8m-4-4 4 4-4 4" />
      <path d="M5 5h14v14H5z" />
    </>
  ),
  moon: (
    <>
      <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 6v5h-5M4 18v-5h5" />
      <path d="M6.1 9a7 7 0 0 1 11.4-2.5L20 11M4 13l2.5 4.5A7 7 0 0 0 17.9 15" />
    </>
  ),
  runs: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8 6 4-6 4V8Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
