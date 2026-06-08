import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, Menu, Moon, Sun, AlertCircle } from 'lucide-angular';
import { RealtimeService } from '../../services/realtime.service';
import { SettingsService } from '../../services/settings.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-top-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, LucideAngularModule],
  templateUrl: './top-navbar.component.html',
})
export class TopNavbarComponent {
  private realtime = inject(RealtimeService);
  private settingsSvc = inject(SettingsService);
  private themeSvc = inject(ThemeService);

  readonly MenuIcon = Menu;
  readonly MoonIcon = Moon;
  readonly SunIcon = Sun;
  readonly AlertIcon = AlertCircle;

  isStreaming = this.realtime.isStreaming;
  latencyMs = this.realtime.latencyMs;
  alertCount = this.realtime.alertCount;
  gpuLoad = this.realtime.gpuLoad;
  theme = this.settingsSvc.theme;
  C = this.themeSvc.colors;

  toggleTheme(): void {
    this.settingsSvc.toggleTheme();
  }

  navbarStyle() {
    const c = this.C();
    return {
      background: c.BG_PANEL,
      borderBottom: `1.5px solid ${c.BORDER}`,
    };
  }

  pillStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      borderColor: c.BORDER,
    };
  }

  inputStyle() {
    const c = this.C();
    return {
      background:  c.BG_CARD,
      color:       c.TEXT,
      borderColor: c.BORDER,
    };
  }

  alertBadgeStyle() {
    const c = this.C();
    if (c.isDark) {
      return {
        background: `color-mix(in srgb, ${c.PINK} 13%, transparent)`,
        borderColor: `color-mix(in srgb, ${c.PINK} 40%, transparent)`,
        color: c.PINK,
        boxShadow: `0 0 8px color-mix(in srgb, ${c.PINK} 27%, transparent)`,
      };
    }
    return {
      background: '#FEF2F2',
      borderColor: '#FECACA',
      color: '#991B1B',
    };
  }

  setHoverAccent(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.color = this.C().INDIGO;
  }
  setHoverMuted(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.color = this.C().MUTED;
  }
}
