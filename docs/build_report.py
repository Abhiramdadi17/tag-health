"""Build PROJECT_REPORT.docx — embeds the five screenshots into a styled Word
document built from the same source-of-truth as PROJECT_REPORT.md.

Run from the project root:  python docs/build_report.py
Output:                     docs/PROJECT_REPORT.docx
"""

from pathlib import Path
from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# --- paths ------------------------------------------------------------------
HERE = Path(__file__).parent
SHOTS = HERE / 'screenshots'
OUT = HERE / 'PROJECT_REPORT.docx'

# --- colours ----------------------------------------------------------------
NAVY = RGBColor(0x10, 0x2A, 0x43)
TEAL = RGBColor(0x06, 0x76, 0x8A)
SLATE = RGBColor(0x33, 0x41, 0x55)
BODY = RGBColor(0x1F, 0x29, 0x37)
MUTED = RGBColor(0x6B, 0x72, 0x80)
CRIT = RGBColor(0xC0, 0x39, 0x2B)
WARN = RGBColor(0xC9, 0x8A, 0x0C)
INFO = RGBColor(0x42, 0x6B, 0xA5)


# --- helpers ----------------------------------------------------------------
def _cell_shading(cell, hex_fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_fill)
    tc_pr.append(shd)


def set_default_font(doc, name='Calibri', size=11):
    style = doc.styles['Normal']
    style.font.name = name
    style.font.size = Pt(size)
    style.font.color.rgb = BODY


def title(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = p.add_run(text)
    r.font.size = Pt(28)
    r.font.bold = True
    r.font.color.rgb = NAVY


def subtitle(doc, text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(13)
    r.italic = True
    r.font.color.rgb = TEAL


def h1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(20)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    r.font.size = Pt(18)
    r.font.bold = True
    r.font.color.rgb = NAVY


def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    r.font.size = Pt(14)
    r.font.bold = True
    r.font.color.rgb = TEAL


def h3(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(text)
    r.font.size = Pt(12)
    r.font.bold = True
    r.font.color.rgb = SLATE


def para(doc, text, italic=False, bold=False, muted=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    r.italic = italic
    r.bold = bold
    if muted:
        r.font.color.rgb = MUTED
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style='List Bullet')
    p.add_run(text)


def numbered(doc, text):
    p = doc.add_paragraph(style='List Number')
    p.add_run(text)


def divider(doc):
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '8')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), 'C5CDD8')
    pBdr.append(bottom)
    pPr.append(pBdr)


def image(doc, fname, caption=None, width_in=6.4):
    path = SHOTS / fname
    if not path.exists():
        para(doc, f'[missing screenshot: {fname}]', italic=True, muted=True)
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Inches(width_in))
    if caption:
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = cap.add_run(f'Figure — {caption}')
        r.italic = True
        r.font.size = Pt(9)
        r.font.color.rgb = MUTED


def table(doc, headers, rows, col_widths=None, severity_col=None):
    """Render a styled table. severity_col=int colours the cell text per row."""
    t = doc.add_table(rows=1 + len(rows), cols=len(headers))
    t.autofit = False
    t.style = 'Light Grid Accent 1'
    # header
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ''
        p = hdr[i].paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.size = Pt(10)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        _cell_shading(hdr[i], '102A43')
    # body
    for ri, row in enumerate(rows, start=1):
        cells = t.rows[ri].cells
        for ci, val in enumerate(row):
            cells[ci].text = ''
            p = cells[ci].paragraphs[0]
            r = p.add_run(str(val))
            r.font.size = Pt(10)
            if severity_col is not None and ci == severity_col:
                sev = str(val).upper()
                if sev == 'CRITICAL':
                    r.font.color.rgb = CRIT
                    r.bold = True
                elif sev == 'WARNING':
                    r.font.color.rgb = WARN
                    r.bold = True
                elif sev == 'INFO':
                    r.font.color.rgb = INFO
    # column widths
    if col_widths:
        for row in t.rows:
            for i, w in enumerate(col_widths):
                row.cells[i].width = Inches(w)
    return t


def code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.5)
    r = p.add_run(text)
    r.font.name = 'Consolas'
    r.font.size = Pt(9)
    r.font.color.rgb = SLATE
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), 'F5F7FA')
    pPr.append(shd)


def page_break(doc):
    doc.add_page_break()


# --- build ------------------------------------------------------------------
doc = Document()
set_default_font(doc)

# margins
for section in doc.sections:
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)

# ============================================================================
# COVER
# ============================================================================
title(doc, 'TAG Health Monitor')
subtitle(doc, 'Real-time tag-quality and batch-health platform for LLPL Plant 1')
divider(doc)
para(doc, 'Prepared by: Engineering Team', bold=True)
para(doc, 'Repository: github.com/Abhiramdadi17/tag-health')
para(doc, 'Status: Phase 1 — Internal preview (functional, locally hosted)')
para(doc, 'Stack: Angular 17 · .NET 8 · ONNX Runtime · ClosedXML')
divider(doc)

# ============================================================================
# 1. EXECUTIVE SUMMARY
# ============================================================================
h1(doc, '1. Executive Summary')
para(doc,
     'TAG Health Monitor is an internal operations console that ingests OPC-UA '
     'telemetry from the LLPL soap-noodle line and surfaces, in a single view, '
     'what every instrumented tag is doing right now and how trustworthy that '
     'signal is. It replaces a manual, spreadsheet-driven inspection workflow '
     'with a typed, rule-validated dashboard backed by a predictive ML layer.')
para(doc, 'In its current state the system:')
bullet(doc, 'Parses four zones of equipment (PSM dosing, Sigma mixers, day/buffer silos, packaging wrappers) from a unified schema.')
bullet(doc, 'Applies 37 deterministic validation rules across those zones, classified by severity (CRITICAL / WARNING / INFO).')
bullet(doc, 'Computes a per-batch health score (passing rows divided by rich-data rows) so operations leads can see at a glance which batches need scrutiny.')
bullet(doc, 'Exposes a single sortable table of 4,500+ rows across 200+ batches with sticky filters for zone, status, date, raw material, recipe, plant, station, cascade, and wrapper.')
bullet(doc, 'Ships an ONNX-backed prediction layer with five trained models (spike-within-5/10/15-minute windows, precursor risk, future error %, and a TFT attention model) that can be promoted to inline predictions next iteration.')

# ============================================================================
# 2. PROBLEM STATEMENT
# ============================================================================
h1(doc, '2. Problem Statement')
para(doc,
     'Plant 1 streams several million telemetry rows per week across PSM, Sigma, '
     'Silo, and Packaging zones. Today, quality issues — bad weights, frozen '
     'sensors, recipe drift, silo cross-contamination — surface only when an '
     'operator notices a downstream defect, often hours after the upstream event.')
para(doc, 'The existing review workflow is:')
numbered(doc, 'Pull last 24 hours of .xlsx from the historian.')
numbered(doc, 'Filter by tag in Excel.')
numbered(doc, 'Eyeball deviations.')
para(doc,
     'This is slow, inconsistent, and undetectable upstream. The system moves '
     'that workflow from reactive spreadsheet review to a continuously-updating, '
     'rule-validated panel with an evidence trail per tag.', bold=True)

# ============================================================================
# 3. DATA SOURCES
# ============================================================================
h1(doc, '3. Data Sources')
para(doc,
     'All data originates from the OPC-UA edge gateway (uaq-lakme-hul-iotedge-01) '
     'on Site LLPL, Sensor opcua. We consume five workbooks served from the data/ '
     'directory through the .NET backend:')
table(doc,
      ['Workbook', 'Rows', 'Period', 'Zone'],
      [
          ['LLPL PSM 1st April to 20th May.xlsx', '~477 K', 'Apr 1 → May 20', 'PSM telemetry'],
          ['PSM_TagData_10th_to_20th.xlsx', 'aggregated', '10–20 May', 'PSM RM-batch'],
          ['LLPL SigmaMixer Zone.xlsx', '~50 K', 'Apr–May', 'Sigma'],
          ['LLPL Silo Zone.xlsx', '~80 K', 'Apr–May', 'Silo'],
          ['LLPL Packaging.xlsx', '~120 K', 'Apr–May', 'Packaging'],
      ],
      col_widths=[2.6, 1.0, 1.4, 1.4])

para(doc, 'The common envelope of every row is the RawTagRow contract:')
code(doc,
     'interface RawTagRow {\n'
     '  IotDeviceId: string;   // \'uaq-lakme-hul-iotedge-01\'\n'
     '  SensorId: string;      // \'opcua\'\n'
     '  SiteId: string;        // \'LLPL\'\n'
     '  MachineId: string;\n'
     '  Tag: string;\n'
     '  Value: string | number;\n'
     '  TS: string;            // \'4/26/2026, 6:00:15.199 AM\'\n'
     '}')

# ============================================================================
# 4. TAG TYPE CATALOGUE
# ============================================================================
page_break(doc)
h1(doc, '4. Tag Type Catalogue')

h2(doc, '4.1 PSM (Personal Soap Maker — dosing skid)')
table(doc,
      ['Sub-type', 'Tag pattern', 'Payload'],
      [
          ['RM-Batch dosing', 'Psm_<plant>_<RM>_Batch', 'D:202641,S:3,B:38,R:PLUMERIA,RM:EDTA,SP:2.05,PV:2.08'],
          ['Batch PV weight', 'PSM_<plant>_Batch_PV_Weight', 'scalar (kg)'],
          ['Batch SP weight', 'PSM_<plant>_Batch_SP_Weight', 'scalar (kg)'],
          ['Batch counter', 'PSM_<plant>_Batch_Counter', 'int'],
          ['Noodle name', 'PSM_<plant>_Noodle_Name', 'string (e.g. JASMINE NOODLES)'],
      ],
      col_widths=[1.7, 2.3, 2.4])
para(doc,
     'The D: field is a Julian date (YYYYDDD); S: is a status code (1 = idle, '
     '2 = dosing, 3 = complete); B: is a 0–39 batch counter; R: is the recipe; '
     'RM: is the raw material; SP/PV are setpoint and process value in kg.')
para(doc, 'Raw materials tracked: EDTA, EHDP, AOS, Salt, Water, Caustic, DFA, EMILY, GLYCERINE, Sodium Sulphate.')

h2(doc, '4.2 Sigma Mixer')
table(doc,
      ['Sub-type', 'Tag substring', 'Payload'],
      [
          ['Batch', 'LAURIC_STRING', 'D/S/B/R/RM/SP/PV schema; RM = Lauric'],
          ['Barcode', 'SM_MX*_BC / _BC', 'numeric barcode, or "Scan Barcode" when idle'],
          ['Rework', 'REWORK', 'int (0 = normal, > 0 = rework active)'],
      ],
      col_widths=[1.4, 2.0, 3.0])
para(doc, 'Two mixers (MX1, MX2) detected from substrings MIXER_2 / MX2 / MX02.')

h2(doc, '4.3 Silo')
table(doc,
      ['Sub-type', 'Tag substring', 'Payload'],
      [
          ['Noodle type', 'type_of_noodle', 'one of seven valid noodle types (or empty when idle)'],
          ['Bag-out detail', 'All_Details', 'batchId,SP,PV,noodleType (single \',\' = idle)'],
          ['Station barcode', 'Scnr_barcode', 'numeric (>=6 digits) when active'],
          ['Warehouse barcode', 'Dosing_Barcode', 'batchId,weight,noodleType,count'],
          ['Shreeji barcode', 'Shreeji', 'barcodeId,MODE,weight  (MODE typically literal "PV")'],
      ],
      col_widths=[1.6, 1.7, 3.1])
para(doc, 'Day silos 1–6 and Buffer silos 1–5 surfaced separately. Station IDs: Stn_01, Stn_02.')

h2(doc, '4.4 Packaging')
table(doc,
      ['Sub-type', 'Tag', 'Payload'],
      [
          ['Wrapper', 'WRA<n> or ACMA1', 'integer grams; target from WRAPPER_TARGETS table'],
      ],
      col_widths=[1.4, 1.8, 3.2])
para(doc,
     'Cascades: CAS3 (WRA2–9, ACMA1; targets 40–150 g) and CAS5_6 (WRA10–16; '
     'targets 39–41 g). Default machine ID is 8005000043300; three wrappers '
     '(WRA3, ACMA1, WRA16) have non-default machine IDs validated against '
     'WRAPPER_MACHINE_MAP.')

h2(doc, '4.5 Valid Noodle Types')
para(doc,
     'JASMINE NOODLES, PLUMERIA NOODLES, SERGIO 56 NOODLES, TEXAS MOD NOODLES, '
     'GALAXY NOODLES, 20 PKO TULIP NOODLES, LILAC NOODLES.')

# ============================================================================
# 5. VALIDATION RULES
# ============================================================================
page_break(doc)
h1(doc, '5. Validation Rules Catalogue')
para(doc,
     'TagValidationService runs 37 rules per tag. Every rule emits a '
     'ValidationResult { ruleId, severity, passed, message }. The batch health '
     'score uses only the passed flag on rows where dataAvailable = true.')

h2(doc, '5.1 General Rules')
table(doc,
      ['ID', 'Severity', 'Description'],
      [
          ['GEN-01', 'WARNING', 'Streaming silence > 5 min during production hours (06:00–22:00 IST)'],
          ['GEN-02', 'WARNING', 'Null or empty value (idle bag-out exempted)'],
          ['GEN-03', 'INFO', 'Timestamps must be monotonically increasing per tag'],
          ['GEN-04', 'INFO', 'Source metadata sanity (SiteId, IotDeviceId, SensorId)'],
      ],
      col_widths=[0.9, 1.0, 4.5],
      severity_col=1)

h2(doc, '5.2 PSM Rules')
table(doc,
      ['ID', 'Severity', 'Description'],
      [
          ['PSM-01', 'CRITICAL', 'Schema must contain all of D, S, B, R, RM, SP, PV'],
          ['PSM-02', 'CRITICAL', 'PV must not be 0 while status = dosing (S=2)'],
          ['PSM-03', 'CRITICAL', 'PV must not be negative'],
          ['PSM-04', 'WARNING', 'PV must not drop > 0.5 kg within the same batch counter'],
          ['PSM-05', 'WARNING', 'Completion deviation |PV-SP|/SP ≤ 5 % when S=3'],
          ['PSM-06', 'WARNING', 'Status code must be 1, 2, or 3'],
          ['PSM-07', 'WARNING', 'Batch counter sequential or 39→0 wrap'],
          ['PSM-08', 'WARNING', 'All RMs in current cycle agree on D and R'],
          ['PSM-09', 'INFO', 'Streaming gap inside production hours'],
          ['PSM-10', 'INFO', 'SP-change detection (event log only)'],
          ['PSM-11', 'INFO', 'Julian date D within 2 days of system time'],
          ['PSM-12', 'INFO', 'Batch_PV_Weight ≈ Σ RM PVs (≤ 2 % deviation)'],
      ],
      col_widths=[0.9, 1.0, 4.5],
      severity_col=1)

h2(doc, '5.3 Sigma Rules')
table(doc,
      ['ID', 'Severity', 'Description'],
      [
          ['SMX-02', 'CRITICAL', 'Barcode must be empty/idle marker, or pure numeric'],
          ['SMX-03', 'WARNING', 'Rework stuck > 0 for > 3 consecutive polls'],
          ['SMX-04', 'WARNING', 'MX1 and MX2 must not dose the same batch counter simultaneously'],
          ['SMX-05', 'INFO', 'Recipe must not change mid-batch'],
      ],
      col_widths=[0.9, 1.0, 4.5],
      severity_col=1)

h2(doc, '5.4 Silo Rules')
table(doc,
      ['ID', 'Severity', 'Description'],
      [
          ['SLO-01', 'CRITICAL', 'Noodle type must be in the valid set'],
          ['SLO-02', 'CRITICAL', 'Bag-out detail must be CSV of 4 fields, or single \',\' for idle'],
          ['SLO-03', 'CRITICAL', 'Bag PV weight ≥ 0'],
          ['SLO-04', 'WARNING', 'Bag PV within 10 % of SP'],
          ['SLO-05', 'WARNING', 'Day-silo and Buffer-silo at same index agree on noodle type'],
          ['SLO-06', 'WARNING', 'Station barcode format (≥ 6 digits) when active'],
          ['SLO-07', 'WARNING', 'Warehouse barcode valid (weight > 0, count 1–6, noodle in set)'],
          ['SLO-08', 'INFO', 'Silo streaming gap > 5 min (Shreeji exempt)'],
          ['SLO-09', 'INFO', 'No silo should be the lone source of a unique noodle type'],
      ],
      col_widths=[0.9, 1.0, 4.5],
      severity_col=1)

h2(doc, '5.5 Packaging Rules')
table(doc,
      ['ID', 'Severity', 'Description'],
      [
          ['PKG-01', 'CRITICAL', 'Grams > 0'],
          ['PKG-02', 'CRITICAL', '|grams − wrapper_target| ≤ 3 g'],
          ['PKG-03', 'WARNING', 'No sudden jump > 5 g between polls'],
          ['PKG-04', 'WARNING', 'Same-target peers in cascade within 3 g spread'],
          ['PKG-05', 'WARNING', 'MachineId matches WRAPPER_MACHINE_MAP expectation'],
          ['PKG-06', 'WARNING', 'Value not frozen for > 5 identical consecutive polls'],
          ['PKG-07', 'INFO', 'Wrapper gap > 6 min'],
      ],
      col_widths=[0.9, 1.0, 4.5],
      severity_col=1)

h2(doc, '5.6 Status Buckets')
table(doc,
      ['Bucket', 'Underlying statuses', 'Colour'],
      [
          ['GOOD', 'OK, NORMAL, COMPLETE, IN-SPEC, ACTIVE, SCANNED', 'Green'],
          ['WARNING', 'ALERT, WARNING, DOSING', 'Yellow'],
          ['CRITICAL', 'SEVERE, CRITICAL, OUT-OF-SPEC, FROZEN, OFFLINE', 'Pink'],
          ['IDLE', 'IDLE', 'Muted'],
      ],
      col_widths=[1.1, 4.0, 1.3])

# ============================================================================
# 6. BATCH HEALTH METHODOLOGY
# ============================================================================
page_break(doc)
h1(doc, '6. Batch Health Methodology')
para(doc, 'ZoneAggregatorService.computeBatchHealth() groups every row by a zone-specific batchKey:')
bullet(doc, 'PSM:  PSM:<plant>:<batchId>:<recipe>')
bullet(doc, 'Sigma:  SIGMA:<mixer>:<batchCounter>')
bullet(doc, 'Silo:  SILO:<barcode> if known, else SILO:<siloId> or SILO:<stationId>')
bullet(doc, 'Packaging:  PACKAGING:<cascade>')
para(doc,
     'Score = passing / total × 100, but only rows with dataAvailable = true count. '
     'Idle barcodes, noodle-name labels, and zero-rework heartbeats don\'t penalise '
     'or credit the batch — only rule-applicable telemetry does.', bold=True)
para(doc,
     'A score ≥ 95 % renders green; ≥ 80 % yellow; otherwise pink, with the '
     'underlying passing / total fraction tooltipped on hover.')

# ============================================================================
# 7. DASHBOARD WALKTHROUGH
# ============================================================================
page_break(doc)
h1(doc, '7. Dashboard Walkthrough')
para(doc,
     'The UI is one Angular page rendered around the UnifiedTagsTableComponent. '
     'The sticky header packages all of the discovery controls together so the '
     'user never loses context while scrolling 4,000+ rows.')

h2(doc, '7.1 Sticky Title Bar')
image(doc, '01-title-bar.png',
      caption='Top sticky header — title, row/batch counter, sort indicator, Data-only toggle, Zone & Status dropdowns, and the Date range row with TODAY / 24H / 7D / 30D / ALL presets.')
para(doc,
     'Row 1 carries the brand, the live row/batch count, the active sort '
     'indicator, the Data only toggle, the Zone dropdown, and the Status '
     'dropdown. Row 2 is the Date range with anchored presets that work on '
     'historical workbooks (anchored on the newest timestamp present, not '
     '"now"). Below that sits the collapsible ZONE FILTERS panel.')

h2(doc, '7.2 Zone Filter Cards (collapsible)')
image(doc, '02-zone-filters.png',
      caption='Zone filter panel expanded — each zone gets its own colour-coded card with column-level filters (Plant, Recipe, RM, Mixer, Station, Noodle, Cascade, Tag Type).')
para(doc,
     'Each zone gets its own column-filter card, colour-coded by zone identity '
     '(PSM cyan, Sigma purple, Silo yellow, Packaging orange). Cards only appear '
     'when the parent Zone dropdown includes them. An "X active" counter and a '
     'RESET ALL button show in the header when any selection is non-default.')

h2(doc, '7.3 Unified Table')
image(doc, '03-unified-table.png',
      caption='Sortable unified table with coloured zone & status chips, deviation gradient, and batch-health pill.')
para(doc,
     'Thirteen columns: ZONE · TAG / ENTITY · MACHINE · BATCH · RECIPE · '
     'RM / NOODLE · STATUS · SP · PV · DEV % · BATCH HEALTH · LATEST VALUE · TS. '
     'Every header except LATEST VALUE is sortable; numeric/date columns toggle '
     'desc-first, text columns asc-first. Deviation % is colour-graded (≤ 5 % '
     'green, ≤ 10 % yellow, otherwise pink). Batch health renders as a coloured '
     'pill with the passing / total fraction beside it.')

h2(doc, '7.4 Tag Detail Drawer')
image(doc, '04-tag-drawer.png',
      caption='Right-side drawer with the full parsed payload, active rule failures, and (for PSM) the last 10 PV readings as a sparkline.')
para(doc,
     'Clicking any row opens a fixed drawer containing the full payload, the '
     'parsed schema, the active rule failures (if any), and — for PSM rows — '
     'the last 10 PV readings rendered as a mini history chart. The drawer '
     'reads from the parent component\'s allRows signal, so cross-batch '
     'comparison is immediate.')

h2(doc, '7.5 Dark / Light Theming')
image(doc, '05-theme.png',
      caption='Theme switching is signal-driven — every component\'s [ngStyle] binding re-evaluates without a route reload.')

# ============================================================================
# 8. PREDICTIVE LAYER
# ============================================================================
page_break(doc)
h1(doc, '8. Predictive Layer (ONNX)')
para(doc, 'backend/Models/onnx/ ships six trained models behind OnnxRiskPredictor:')
table(doc,
      ['Model', 'Purpose', 'Output'],
      [
          ['spike_5m.onnx', 'P(weight-spike within 5 min)', 'probability'],
          ['spike_10m.onnx', 'P(weight-spike within 10 min)', 'probability'],
          ['spike_15m.onnx', 'P(weight-spike within 15 min)', 'probability'],
          ['spike_within_window.onnx', 'P(spike anywhere in next 15 min)', 'probability'],
          ['precursor_risk.onnx', 'P(current window leads to a defective batch)', 'probability'],
          ['future_error_pct.onnx', 'Regression: |PV-SP|/SP 5 min ahead', 'float'],
          ['tft.onnx', 'TFT — attention weights for explainability', 'tensor'],
      ],
      col_widths=[2.0, 3.8, 1.3])
para(doc,
     'RiskPredictorService wraps these. FeatureEngineer / PythonFeatureEngineer '
     'produce the rolling features (pv_lag_*, sp_lag_*, dev_ewma_*, gap_seconds, '
     'recipe one-hot, RM one-hot) consumed by the models. They are reached from '
     '/predict?tag=…&horizon=… but are not yet wired into the dashboard cells — '
     'promoting them inline is the headline item on the next-iteration list.')

# ============================================================================
# 9. WHAT'S IMPLEMENTED TODAY
# ============================================================================
page_break(doc)
h1(doc, '9. What\'s Implemented Today')
items = [
    'OPC-UA workbook loaders for PSM, PSM telemetry, Sigma, Silo, Packaging (lazy + cached)',
    'Strongly-typed parser for every tag sub-type (TagParserService)',
    '37 deterministic validation rules (TagValidationService)',
    'Unified-row model with dataAvailable gating so the batch score isn\'t diluted by idle rows',
    'ZoneAggregatorService.computeBatchHealth() — passing ÷ rich-total per batch key',
    'Single-page dashboard with sticky header (title · data-only · date · zone · status)',
    'Collapsible per-zone column filters (PSM / SIGMA / SILO / PACKAGING)',
    'Sortable, themed table with deviation gradient and health pills',
    'Tag detail drawer with last-10 readings chart for PSM rows',
    'Dark / light theme switcher',
    'Six ONNX models present and load-tested in OnnxRiskPredictor',
    'Date-range filtering with anchored presets (works on historical workbooks)',
    'Repository on GitHub with .gitignore and README',
]
for it in items:
    bullet(doc, f'[done]  {it}')

# ============================================================================
# 10. ROADMAP
# ============================================================================
page_break(doc)
h1(doc, '10. Roadmap — Next Iterations')

h2(doc, '10.1 Near-term (2-week sprint)')
near = [
    ('Inline predictions in the table.',
     'Render a RISK 5m / 10m / 15m mini-gauge per row sourced from the spike models. Hovering reveals the top three TFT-attention features driving the score. Most impactful change: converts the dashboard from "what is happening" to "what is about to happen."'),
    ('Alert log view.',
     'A second tab that lists every failed rule chronologically, grouped by tag, with severity counts in the header. Required for shift handovers.'),
    ('Per-RM SP-range gauges.',
     'RM_SP_RANGES is already defined; render a horizontal min/max band under each PSM row showing where the current SP sits inside the engineering range.'),
    ('CSV / XLSX export.',
     'One-click export of the currently filtered view, ready for an operations email.'),
    ('WebSocket push from the backend.',
     'Table refreshes without polling once the historian is replaced by a live OPC-UA gateway.'),
]
for i, (t, d) in enumerate(near, 1):
    h3(doc, f'{i}. {t}')
    para(doc, d)

h2(doc, '10.2 Mid-term (1 quarter)')
mid = [
    ('Recipe-aware anomaly thresholds.',
     'Replace the flat ±5 % deviation threshold with per-recipe, per-RM dynamic thresholds learnt from the future_error_pct model — tight on stable recipes, wide on noisy ones.'),
    ('Batch lineage view.',
     'Connect PSM → Sigma → Silo → Packaging by batchId and recipe; render a Sankey of how a single batch flows through the line, with rule failures and health scores rendered at each node.'),
    ('Operator annotations.',
     'Let an operator click a failing row and attach a free-text reason. Annotations persist on the batch key and become labels for retraining the ML models.'),
    ('Predictive-maintenance feed for Packaging.',
     'PKG-06 (frozen value) already detects sensor sticking. Promote sticky-sensor events into a maintenance ticket queue (Jira / SAP PM).'),
    ('Multi-site support.',
     'SiteId is already enforced in GEN-04; generalise the loader to consume a registry of sites and surface site selection in the title bar.'),
]
for i, (t, d) in enumerate(mid, 6):
    h3(doc, f'{i}. {t}')
    para(doc, d)

h2(doc, '10.3 Long-term (2–4 quarters)')
lng = [
    ('Closed-loop control suggestions.',
     'When spike-15m predicts a defective batch with high confidence and the precursor model agrees, surface a concrete corrective action (e.g. "Reduce AOS SP by 0.4 kg") learnt from historical successful interventions.'),
    ('Cross-line comparison.',
     'Once we have ≥ 2 sites streaming, surface a league table of OEE, recipe yield, and defect rate per shift across plants.'),
    ('Mobile shop-floor view.',
     'A read-only PWA build of the table scoped to one machine, deployable on a wall-mounted tablet next to each cell.'),
    ('Native ingestion from MQTT / Kafka.',
     'Replace .xlsx historian reads with a streaming source so latency drops from ~3 s to sub-100 ms.'),
]
for i, (t, d) in enumerate(lng, 11):
    h3(doc, f'{i}. {t}')
    para(doc, d)

# ============================================================================
# 11. DATA INSIGHTS WE CAN ADD
# ============================================================================
page_break(doc)
h1(doc, '11. Data Insights We Can Add')
para(doc,
     'Beyond the operational dashboard, the dataset is rich enough to surface '
     'insights that are not in scope today but would be high-value reports for '
     'the project manager and plant head.')
insights = [
    ('Yield-per-recipe trendline.', 'Average |PV−SP|/SP per recipe across the last 30 days, ranked. Identifies the recipes that are hardest to dose accurately.'),
    ('RM contribution to defects.', 'For every CRITICAL rule failure on a batch, decompose which raw material\'s row failed. Shows whether (e.g.) Caustic dosing is the dominant cause of batch defects.'),
    ('Operator / shift heatmap.', 'Group rule failures by hour of day. Surfaces shift transitions, lunch dips, and pre/post-maintenance windows where the line is unstable.'),
    ('Wrapper-to-cascade efficiency.', 'Average grams-deviation per wrapper grouped by cascade. PKG-04 enforces this; the chart highlights long-term outlier wrappers for maintenance prioritisation.'),
    ('Silo cross-contamination probability.', 'Cross-tabulate SLO-05 failures by silo-index. Output is a heatmap of which day/buffer pairs disagree most often — direct input to the silo cleaning schedule.'),
    ('Comms reliability per device.', 'GEN-01 / PKG-07 / SLO-08 gap events grouped by MachineId. Identifies which OPC-UA endpoints are flaky and need an edge-gateway refresh.'),
    ('Batch-completion histogram.', 'Distribution of time-to-complete per recipe. Median and 95th-percentile = capacity baseline for production planning.'),
    ('Predictive-vs-actual ROC.', 'Plot the ROC curve of spike_15m against the labels actually emitted by the rule engine over the last 30 days. Monthly KPI for "is the ML still trustworthy."'),
    ('Recipe drift detection.', 'Use psm10_spChangeDetection to draw an SP-evolution chart per recipe. Detects silent retuning without paperwork.'),
    ('Noodle-type purity audit.', 'For every batch, ratio of expected vs observed noodle types across the day silos that feed it. Adds a "purity %" column — relevant for the customer audit pack.'),
]
for i, (t, d) in enumerate(insights, 1):
    h3(doc, f'{i}. {t}')
    para(doc, d)

# ============================================================================
# 12. KPIs SURFACED
# ============================================================================
page_break(doc)
h1(doc, '12. KPIs Already Surfaced')
para(doc, 'Live numbers on the current dashboard; any of these can be promoted to executive cards:')
for it in [
    'Total rows monitored, total batches monitored',
    'Active filter health score (global, scoped to current view)',
    'Per-batch health score (with passing / total fraction)',
    'Active CRITICAL / WARNING / INFO count by zone',
    'Deviation distribution (green / yellow / pink banding on every numeric row)',
    'Date span of currently loaded data',
    'Per-RM, per-recipe, per-mixer, per-cascade row counts via the dropdowns',
]:
    bullet(doc, it)

# ============================================================================
# 13. TECH STACK
# ============================================================================
h1(doc, '13. Technical Stack')
table(doc,
      ['Layer', 'Technology', 'Notes'],
      [
          ['Frontend', 'Angular 17, TypeScript 5, Tailwind CSS', 'Standalone components, signal-based reactivity'],
          ['Frontend state', 'Angular signals (no NgRx)', 'signal, computed, input.required, output'],
          ['Backend', '.NET 8 Minimal API', 'C# 12, async loaders, in-memory caching'],
          ['Data ingestion', 'ClosedXML (workbook reader)', 'Streams .xlsx files from data/'],
          ['ML runtime', 'Microsoft.ML.OnnxRuntime', 'Loads 6 ONNX models on startup'],
          ['Build / deploy', 'ng build + dotnet publish', 'Localhost; container-ready'],
          ['Repo', 'Git on GitHub — tag-health', 'Branch: master'],
      ],
      col_widths=[1.4, 2.2, 3.3])

# ============================================================================
# 14. RISKS
# ============================================================================
h1(doc, '14. Risks & Mitigations')
table(doc,
      ['Risk', 'Likelihood', 'Mitigation'],
      [
          ['Historian schema changes break parser substring detection', 'Medium', 'Parser is centralised; one file changes. Add a smoke test asserting at least one row per zone parses.'],
          ['ML models drift as recipes change', 'High', 'Add predictive-vs-actual ROC report (Insight #8); retrain monthly.'],
          ['Workbook loading > 5 s on large files', 'Medium', 'Already cached per-zone after first load; long-term move to streaming ingestion.'],
          ['User-action attribution is impossible without operator annotations', 'High', 'Operator annotations item (mid-term #8) closes this gap.'],
      ],
      col_widths=[3.0, 1.0, 3.0])

# ============================================================================
# 15. CLOSING
# ============================================================================
h1(doc, '15. Closing')
para(doc,
     'The platform converts a reactive Excel workflow into a proactive, '
     'rule-validated, ML-augmented operations view. Phase 1 is complete and '
     'demonstrable; the immediate next move is to surface the existing ONNX '
     'predictions inline and to ship the alert-log tab so the system can '
     'replace the daily review meeting rather than supplement it.')
para(doc,
     'Demonstration is available locally — backend on localhost:5050, frontend '
     'on localhost:4200. The repository at github.com/Abhiramdadi17/tag-health '
     'contains everything required to reproduce the build.')

# ============================================================================
# QUICK START
# ============================================================================
h2(doc, 'Appendix — Quick Start')
code(doc,
     '# Backend\n'
     'cd backend\n'
     'dotnet run                # listens on http://localhost:5050\n\n'
     '# Frontend (new terminal)\n'
     'cd frontend\n'
     'npm install\n'
     'npm start                 # serves http://localhost:4200')

# --- save -------------------------------------------------------------------
doc.save(OUT)
print(f'wrote {OUT}')
