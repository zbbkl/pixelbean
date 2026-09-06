import type { MobileSection } from '../types';

interface Props {
  active: MobileSection;
  onChange: (section: MobileSection) => void;
}

const tabs: { id: MobileSection; label: string }[] = [
  { id: 'params', label: '图片参数' },
  { id: 'preview', label: '图纸' },
  { id: 'stats', label: '用量导出' }
];

export function MobileNav({ active, onChange }: Props) {
  return (
    <nav className="mobile-nav" aria-label="移动端分区">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={active === tab.id ? 'active' : ''}
          type="button"
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onChange(tab.id)}
        >
          <span className="mobile-nav-dot" />
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
