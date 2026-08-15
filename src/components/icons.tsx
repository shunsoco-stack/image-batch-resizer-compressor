import type { SVGProps } from "react";

export type IconName =
  | "add"
  | "archive"
  | "arrow-down"
  | "arrow-left-right"
  | "arrow-up"
  | "check"
  | "chevron"
  | "close"
  | "compare"
  | "compress"
  | "crop"
  | "download"
  | "error"
  | "format"
  | "gallery"
  | "image"
  | "info"
  | "lock"
  | "metadata"
  | "minus"
  | "play"
  | "plus"
  | "refresh"
  | "rename"
  | "resize"
  | "save"
  | "settings"
  | "sparkles"
  | "spinner"
  | "template"
  | "trash"
  | "upload"
  | "warning"
  | "workflow"
  | "zoom-in"
  | "zoom-out";

const paths: Record<IconName, React.ReactNode> = {
  add: <><path d="M12 5v14M5 12h14" /></>,
  archive: <><path d="M4 7.5h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M3 3.5h18v4H3zM9.5 12h5" /></>,
  "arrow-down": <><path d="M12 4v16M6.5 14.5 12 20l5.5-5.5" /></>,
  "arrow-left-right": <><path d="m8 7-4 4 4 4M4 11h16M16 17l4-4-4-4" /></>,
  "arrow-up": <><path d="M12 20V4M6.5 9.5 12 4l5.5 5.5" /></>,
  check: <path d="m5 12.5 4.1 4.1L19 6.8" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  compare: <><path d="M4 5.5h6v13H4zM14 5.5h6v13h-6zM12 3v18" /></>,
  compress: <><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" /><path d="m3 8 5-5m13 5-5-5M3 16l5 5m13-5-5 5" /></>,
  crop: <><path d="M6 3v15h15M3 6h15v15" /><path d="M18 3v3M3 18h3" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M4 18v2h16v-2" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v6M12 17h.01" /></>,
  format: <><path d="M5 3.5h10l4 4v13H5z" /><path d="M15 3.5v4h4M8 13h8M8 16.5h6" /></>,
  gallery: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="m5.5 17 4.2-4.2 3.1 3.1 2.2-2.2 3.5 3.3" /></>,
  image: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="m5.5 17 4.2-4.2 3.1 3.1 2.2-2.2 3.5 3.3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  metadata: <><circle cx="12" cy="12" r="9" /><path d="M9.5 8.5h5M9.5 12h5M9.5 15.5h3" /></>,
  minus: <path d="M5 12h14" />,
  play: <path d="m9 6 9 6-9 6z" />,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M18.2 16a8 8 0 1 1 .2-8.2L20 12" /></>,
  rename: <><path d="M4 6h10M9 6v12M5.5 18h7" /><path d="m15 16 4.7-4.7-3-3L12 13v3z" /></>,
  resize: <><path d="M9 4H4v5M15 20h5v-5M4 9l6-6M20 15l-6 6" /><rect x="8" y="8" width="8" height="8" rx="1" /></>,
  save: <><path d="M4 4h13l3 3v13H4z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7zM5.5 13l.8 2.7 2.7.8-2.7.8L5.5 20l-.8-2.7-2.7-.8 2.7-.8z" /></>,
  spinner: <><path d="M21 12a9 9 0 1 1-5.3-8.2" /><path d="M16 3.8h4.5v4.5" /></>,
  template: <><path d="M5 3.5h14v17H5z" /><path d="M8 7h8M8 11h8M8 15h5" /></>,
  trash: <><path d="M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14M10 11v6M14 11v6" /></>,
  upload: <><path d="M12 17V5m-5 5 5-5 5 5" /><path d="M4 17v3h16v-3" /></>,
  warning: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5M12 17h.01" /></>,
  workflow: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="6" cy="19" r="2" /><path d="M8 5h3a3 3 0 0 1 3 3v1a3 3 0 0 0 3 3M8 19h3a3 3 0 0 0 3-3v-1a3 3 0 0 1 3-3" /></>,
  "zoom-in": <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" /></>,
  "zoom-out": <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 10.5h6" /></>,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function AppMark({ title = "画像一括リサイズ・圧縮ツール" }: { title?: string }) {
  return (
    <svg role="img" aria-label={title} viewBox="0 0 64 64">
      <defs>
        <linearGradient id="app-mark-bg" x1="8" y1="5" x2="57" y2="61" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3694FF" />
          <stop offset="0.56" stopColor="#1769E0" />
          <stop offset="1" stopColor="#1155BB" />
        </linearGradient>
        <linearGradient id="app-mark-photo" x1="17" y1="21" x2="45" y2="47" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DDF2FF" />
          <stop offset="1" stopColor="#85D9CD" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#app-mark-bg)" />
      <path d="M15 19.5a4.5 4.5 0 0 1 4.5-4.5h21a4.5 4.5 0 0 1 4.5 4.5v22a4.5 4.5 0 0 1-4.5 4.5h-21a4.5 4.5 0 0 1-4.5-4.5z" fill="rgba(255,255,255,.94)" />
      <circle cx="24" cy="25" r="3.2" fill="#54A8F6" />
      <path d="m19 40 8-8 5.2 5.1 3.9-4 5.2 5.4V42H19z" fill="url(#app-mark-photo)" />
      <path d="M10 13h9m-9 0 3.5-3.5M10 13l3.5 3.5M54 51h-9m9 0-3.5-3.5M54 51l-3.5 3.5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M49.5 23.5h7M49.5 27h7M49.5 30.5h7" stroke="#B8E9E6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
