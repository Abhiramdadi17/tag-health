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

  pillStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      border: `1px solid ${c.BORDER}`,
      color: c.MUTED,
    };
  }

  liveDotStyle() {
    const c = this.C();
    return {
      background: this.isStreaming() ? c.GREEN : c.MUTED,
    };
  }

  alertBadgeStyle() {
    const c = this.C();
    return {
      background: `${c.PINK}22`,
      borderColor: `${c.PINK}66`,
      color: c.PINK,
      boxShadow: c.isDark ? `0 0 8px ${c.PINK}44` : 'none',
    };
  }

  logoStyle() {
    const c = this.C();
    return {
      color: c.CYAN,
      textShadow: c.isDark ? `0 0 10px ${c.CYAN}66` : 'none',
    };
  }

  setHoverCyan(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.color = this.C().CYAN;
  }
  setHoverMuted(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.color = this.C().MUTED;
  }
}
