import type { CSSProperties } from 'react';
const paths: Record<string, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/><path d="M8 6V3H5v5"/></>,
  book: <><path d="M4 4h7a4 4 0 0 1 4 3v14a4 4 0 0 0-4-2H4Zm11 3c1-2 3-3 6-3v15c-3 0-5 0-6 2"/><path d="M7 8h4M7 12h4"/></>,
  leaf: <><path d="M20 3C8 2 2 8 5 15c3 7 14 6 15-12Z"/><path d="m3 21 12-12M9 15V9m0 6h6"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
  mic: <><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
  plus: <path d="M12 4v16M4 12h16"/>,
  wallet: <><path d="M20 7V4H6a3 3 0 0 0 0 6h15v10H6a3 3 0 0 1-3-3V7"/><path d="M21 12h-6v5h6"/><path d="M17 14.5h.1"/></>,
  jar: <><path d="M8 3h8v4c4 2 5 5 4 10-1 4-15 4-16 0-1-5 0-8 4-10Z"/><path d="M8 7h8M9 14l2 2 4-4"/></>,
  star: <path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.1 6.2-5.5-3-5.5 3 1.1-6.2L3 9.6l6.3-.8Z"/>,
  cup: <><path d="M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z M16 9h2a3 3 0 0 1 0 6h-2M7 3v2M12 2v3"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>,
  bag: <><path d="M5 7h14l1 14H4ZM9 8V6a3 3 0 0 1 6 0v2"/></>,
  bus: <><rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M8 15h1m6 0h1M8 19v2m8-2v2"/></>,
  heart: <path d="M12 20S3 15 3 8c0-5 7-6 9-1 2-5 9-4 9 1 0 7-9 12-9 12Z"/>,
  play: <><rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 5 3-5 3Z"/></>,
};
export const categoryIcon: Record<string,string> = {'餐饮':'cup','交通':'bus','购物':'bag','娱乐':'play','居住':'home','医疗':'heart','学习':'book','其他':'leaf','收入':'wallet'};
export function StoryIcon({name, className='', style}: {name:string; className?:string; style?:CSSProperties}) {
  return <svg className={`story-icon ${className}`} style={style} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.leaf}</svg>;
}
