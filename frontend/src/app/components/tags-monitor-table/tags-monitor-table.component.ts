import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TagRecord } from '../../types';
import { ThemeService } from '../../services/theme.service';

const COLUMNS = ['TAG ID', 'PLANT', 'RECIPE', 'MATERIAL', 'BATCH', 'SHIFT', 'DEV %', 'PV / SP', 'READINGS', 'STATUS'];

@Component({
  selector: 'app-tags-monitor-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tags-monitor-table.component.html',
})
export class TagsMonitorTableComponent {
  private themeSvc = inject(ThemeService);

  tags = input.required<TagRecord[]>();
  tagClick = output<TagRecord>();

  C = this.themeSvc.colors;
  columns = COLUMNS;

  statusCounts = computed(() => {
    const acc: Record<string, number> = {};
    for (const tag of this.tags()) {
      acc[tag.health_status] = (acc[tag.health_status] ?? 0) + 1;
    }
    return Object.entries(acc);
  });

  headerStyle() {
    const c = this.C();
    return { background: c.BG_PANEL, borderColor: c.BORDER };
  }

  titleStyle() {
    const c = this.C();
    return { color: c.CYAN, textShadow: c.isDark ? `0 0 8px ${c.CYAN}66` : 'none' };
  }

  getStatusStyle(status: string): Record<string, string> {
    const c = this.C();
    const colorMap: Record<string, string> = {
      OK: c.GREEN,
      ALERT: c.YELLOW,
      WARNING: c.ORANGE,
      SEVERE: c.PINK,
      CRITICAL: c.PINK,
    };
    const col = colorMap[status] ?? c.MUTED;
    return {
      color: col,
      borderColor: `${col}44`,
      background: `${col}11`,
      boxShadow: c.isDark ? `0 0 8px ${col}44` : 'none',
    };
  }

  getDevColor(dev: number): string {
    const c = this.C();
    const a = Math.abs(dev);
    if (a < 5) return c.GREEN;
    if (a < 10) return c.YELLOW;
    if (a < 15) return c.ORANGE;
    return c.PINK;
  }

  headRowStyle() {
    const c = this.C();
    return { borderColor: c.BORDER, background: c.BG_BASE };
  }

  thAlign(i: number): string {
    if (i === 4 || i === 5 || i === 8 || i === 9) return 'text-center';
    if (i === 6 || i === 7) return 'text-right';
    return 'text-left';
  }

  rowMouseEnter(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.background = this.C().BG_CARD;
  }

  rowMouseLeave(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.background = 'transparent';
  }

  onTagClick(tag: TagRecord): void {
    this.tagClick.emit(tag);
  }

  readingsBadgeStyle() {
    const c = this.C();
    return {
      color: c.CYAN,
      borderColor: `${c.CYAN}44`,
      background: `${c.CYAN}11`,
    };
  }
}
