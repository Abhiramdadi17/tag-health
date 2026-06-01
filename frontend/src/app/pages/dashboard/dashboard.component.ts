import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, AlertCircle } from 'lucide-angular';
import { TagsMonitorTableComponent } from '../../components/tags-monitor-table/tags-monitor-table.component';
import { PredictionDrawerComponent } from '../../components/prediction-drawer/prediction-drawer.component';
import { TagService } from '../../services/tag.service';
import { ThemeService } from '../../services/theme.service';
import { TagRecord, PredictionResult } from '../../types';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    TagsMonitorTableComponent,
    PredictionDrawerComponent,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private tagSvc = inject(TagService);
  private themeSvc = inject(ThemeService);

  readonly AlertIcon = AlertCircle;
  C = this.themeSvc.colors;

  tags = signal<TagRecord[]>([]);
  predictions = signal<Record<string, PredictionResult>>({});
  loading = signal(true);
  error = signal('');

  searchQuery = signal('');
  selectedPlant = signal('ALL');
  selectedRecipe = signal('ALL');
  selectedMaterial = signal('ALL');
  selectedStatus = signal('ALL');
  selectedTag = signal<TagRecord | null>(null);

  plants = computed(() => ['ALL', ...Array.from(new Set(this.tags().map(t => t.plant)))]);
  recipes = computed(() => ['ALL', ...Array.from(new Set(this.tags().map(t => t.recipe)))]);
  materials = computed(() => ['ALL', ...Array.from(new Set(this.tags().map(t => t.raw_material)))]);

  filteredTags = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const plant = this.selectedPlant();
    const recipe = this.selectedRecipe();
    const material = this.selectedMaterial();
    const status = this.selectedStatus();
    return this.tags().filter(tag => {
      const matchesSearch =
        q === '' ||
        tag.synthetic_id.toLowerCase().includes(q) ||
        tag.raw_material.toLowerCase().includes(q);
      return (
        matchesSearch &&
        (plant === 'ALL' || tag.plant === plant) &&
        (recipe === 'ALL' || tag.recipe === recipe) &&
        (material === 'ALL' || tag.raw_material === material) &&
        (status === 'ALL' || tag.health_status === status)
      );
    });
  });

  selectedPrediction = computed(() => {
    const tag = this.selectedTag();
    if (!tag) return undefined;
    return this.predictions()[tag.synthetic_id];
  });

  constructor() {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const tags = await this.tagSvc.fetchTags();
      this.tags.set(tags);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load tags');
    } finally {
      this.loading.set(false);
    }
  }

  selectStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      color: c.TEXT,
      border: `1px solid ${c.BORDER}`,
      borderRadius: '6px',
      padding: '6px 10px',
      fontSize: '13px',
    };
  }

  searchStyle() {
    return { ...this.selectStyle(), flex: '1' };
  }

  filterBarStyle() {
    const c = this.C();
    return { background: c.BG_PANEL, borderColor: c.BORDER };
  }

  rightPanelStyle() {
    const c = this.C();
    return { background: c.BG_PANEL, borderColor: c.BORDER };
  }

  async onTagClick(tag: TagRecord): Promise<void> {
    this.selectedTag.set(tag);
    if (!this.predictions()[tag.synthetic_id]) {
      try {
        const pred = await this.tagSvc.predict(tag, 50.0);
        this.predictions.update(prev => ({ ...prev, [tag.synthetic_id]: pred }));
      } catch (err) {
        console.error('Prediction failed:', err);
      }
    }
  }

  closeDrawer(): void {
    this.selectedTag.set(null);
  }
}
