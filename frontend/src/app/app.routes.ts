import { Routes } from '@angular/router';
import { SettingsComponent } from './pages/settings/settings.component';
import { ZonesDashboardComponent } from './pages/zones/zones-dashboard.component';

export const routes: Routes = [
  { path: '', component: ZonesDashboardComponent },
  { path: 'zones', component: ZonesDashboardComponent },
  { path: 'settings', component: SettingsComponent },
];
