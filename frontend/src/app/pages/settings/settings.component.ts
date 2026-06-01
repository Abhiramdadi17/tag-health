import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Moon, Sun, RotateCcw } from 'lucide-angular';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  private settingsSvc = inject(SettingsService);

  readonly MoonIcon = Moon;
  readonly SunIcon = Sun;
  readonly ResetIcon = RotateCcw;

  theme = this.settingsSvc.theme;
  updateFrequency = this.settingsSvc.updateFrequency;
  chartType = this.settingsSvc.chartType;
  autoRefresh = this.settingsSvc.autoRefresh;
  showAdvancedMetrics = this.settingsSvc.showAdvancedMetrics;

  toggleTheme(): void {
    this.settingsSvc.toggleTheme();
  }

  setUpdateFrequency(freq: number | string): void {
    this.settingsSvc.setUpdateFrequency(typeof freq === 'string' ? parseInt(freq, 10) : freq);
  }

  setChartType(type: string): void {
    this.settingsSvc.setChartType(type as 'recharts' | 'plotly');
  }

  setAutoRefresh(enabled: boolean): void {
    this.settingsSvc.setAutoRefresh(enabled);
  }

  setShowAdvancedMetrics(show: boolean): void {
    this.settingsSvc.setShowAdvancedMetrics(show);
  }

  resetDefaults(): void {
    this.settingsSvc.resetDefaults();
  }
}
