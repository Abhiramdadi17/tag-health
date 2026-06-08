import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TagRecord } from '../../types';
import { ThemeService } from '../../services/theme.service';

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

  statusCounts = computed(() => {
    const acc: Record<string, number> = {};
    for (const tag of this.tags()) {
      acc[tag.health_status] = (acc[tag.health_status] ?? 0) + 1;
    }
    return Object.entries(acc);
  });

  /** Returns CSS class name for status chip */
  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      OK:       'chip-ok',
      CRITICAL: 'chip-critical',
      SEVERE:   'chip-critical',
      ALERT:    'chip-alert',
      WARNING:  'chip-alert',
    };
    return map[status] ?? 'chip-normal';
  }

  /** Returns CSS class name for DEV% pill */
  getDevClass(dev: number): string {
    if (Math.abs(dev) < 0.5) return 'dev-zero';
    return dev > 0 ? 'dev-positive' : 'dev-negative';
  }

  /**
   * Map plant/material to zone label.
   * Extend the logic here to match your actual data if needed.
   */
  getZoneLabel(plant: string): string {
    const p = plant?.toUpperCase() ?? '';
    if (p.includes('A') || p.includes('SIGMA'))      return 'SIGMA';
    if (p.includes('B') || p.includes('PSM'))        return 'PSM';
    if (p.includes('C') || p.includes('SILO'))       return 'SILO';
    if (p.includes('D') || p.includes('PACK'))       return 'PKG';
    // fallback — show first 4 chars so it still renders meaningful
    return (plant ?? '???').substring(0, 4).toUpperCase();
  }

  /** Returns CSS class name for zone badge */
  getZoneClass(plant: string): string {
    const label = this.getZoneLabel(plant);
    const map: Record<string, string> = {
      SIGMA: 'badge-sigma',
      PSM:   'badge-psm',
      SILO:  'badge-silo',
      PKG:   'badge-packaging',
    };
    return map[label] ?? 'badge-psm';
  }

  rowMouseEnter(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.background = this.C().BG_HOVER;
  }

  rowMouseLeave(ev: MouseEvent, idx: number): void {
    const c = this.C();
    (ev.currentTarget as HTMLElement).style.background =
      idx % 2 === 1 ? c.BG_ROW_ALT : c.BG_PANEL;
  }

  onTagClick(tag: TagRecord): void {
    this.tagClick.emit(tag);
  }
}
