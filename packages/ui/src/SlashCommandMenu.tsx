import { useEffect, useRef } from 'react';
import './SlashCommandMenu.css';

export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  filter: string;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
}

export function SlashCommandMenu({ commands, filter, selectedIndex, onSelect }: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = commands.filter(cmd =>
    cmd.name.toLowerCase().startsWith(filter.toLowerCase())
  );

  useEffect(() => {
    const el = menuRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div className="pit-slash-menu" ref={menuRef}>
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          className={`pit-slash-menu-item ${i === selectedIndex ? 'pit-slash-menu-item-active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(cmd); }}
        >
          <span className="pit-slash-menu-icon">{cmd.icon}</span>
          <div className="pit-slash-menu-text">
            <span className="pit-slash-menu-label">{cmd.label}</span>
            <span className="pit-slash-menu-desc">{cmd.description}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
