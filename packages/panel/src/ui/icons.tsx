import type { ReactNode } from "react";

/* Jeu d'icônes trait (stroke) 20px, style « lucide », pour la nav et les widgets. */
const svg = (children: ReactNode, size = 20) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

export const Icon = {
  home: () => svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  sliders: () =>
    svg(<><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /><circle cx="9" cy="6" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="8" cy="18" r="2" fill="currentColor" /></>),
  command: () => svg(<><polyline points="7 8 3 12 7 16" /><polyline points="17 8 21 12 17 16" /><line x1="14" y1="4" x2="10" y2="20" /></>),
  ticket: () => svg(<><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" /><line x1="12" y1="7" x2="12" y2="17" strokeDasharray="2 3" /></>),
  tag: () => svg(<><path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" /></>),
  wave: () => svg(<><path d="M4 12a8 8 0 0 1 16 0" /><path d="M8 12a4 4 0 0 1 8 0" /><line x1="12" y1="3" x2="12" y2="5" /><line x1="12" y1="16" x2="12" y2="21" /></>),
  shield: () => svg(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>),
  trophy: () => svg(<><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3" /><path d="M7 5H4v2a3 3 0 0 0 3 3" /></>),
  music: () => svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  scroll: () => svg(<><path d="M8 3h9a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6" /><path d="M4 6a2 2 0 0 1 4 0v0" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /></>),
  key: () => svg(<><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 8-8" /><path d="m16 5 3 3" /><path d="m19 8 2-2-3-3-2 2" /></>),
  users: () => svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>),
  hash: () => svg(<><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></>),
  mic: () => svg(<><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" /></>),
  chart: () => svg(<><line x1="4" y1="20" x2="20" y2="20" /><line x1="7" y1="20" x2="7" y2="13" /><line x1="12" y1="20" x2="12" y2="5" /><line x1="17" y1="20" x2="17" y2="10" /></>),
  bolt: () => svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />),
  menu: () => svg(<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>),
  close: () => svg(<><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>),
  chevron: () => svg(<polyline points="6 9 12 15 18 9" />),
  gavel: () => svg(<><path d="m14 13-7 7" /><path d="M3 21h8" /><path d="m9 8 7 7" /><path d="m5 12 5-5" /><path d="m12 5 5 5" /><path d="m16 3 5 5-2 2-5-5z" /></>),
  logout: () => svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>),
};

export type IconName = keyof typeof Icon;
