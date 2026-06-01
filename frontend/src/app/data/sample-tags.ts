import { RawTagRow } from '../types/tags';

// ============================================================================
// Sample OPC-UA telemetry rows — exercises the parser + validation pipeline
// so the three new zones render with realistic data (and a few seeded faults).
// ============================================================================

const ENV = {
  IotDeviceId: 'uaq-lakme-hul-iotedge-01',
  SensorId: 'opcua',
  SiteId: 'LLPL',
};

const ts = (offsetSec = 0) => {
  const d = new Date(Date.now() - offsetSec * 1000);
  return d.toLocaleString('en-US', { hour12: true });
};

function row(MachineId: string, Tag: string, Value: string | number, offset = 0): RawTagRow {
  return { ...ENV, MachineId, Tag, Value, TS: ts(offset) };
}

export const SAMPLE_TAG_ROWS: RawTagRow[] = [
  // ---------------------------------------------------------------- SIGMA ----
  row('800500104343-1',
    'LOGIX_cas2_pwp_llpl.cas2_pwp_llpl.MIXER_1_LAURIC_STRING',
    'D:2026151,S:2,B:22,R:LMST5R5_LBGRMEXP+_600KG,RM:Lauric,SP:0.660,PV:0.512'),
  row('800500104343-1',
    'LOGIX_cas2_pwp_llpl.cas2_pwp_llpl.MIXER_2_LAURIC_STRING',
    'D:2026151,S:3,B:18,R:LMST5R5_LBGRMEXP+_600KG,RM:Lauric,SP:0.660,PV:0.731'), // SP/PV dev > 10%
  row('800500104346-1', 'TSPCAS3.Cascade3.SM_MX1_BC', '8847123901'),
  row('800500104346-1', 'TSPCAS3.Cascade3.SM_MX2_BC', 'Scan Barcode'),
  row('800500066581', 'LOGIX_cas2_pwp_llpl.cas2_pwp_llpl.MX01_REWORK_600kg', 0),
  row('800500066581', 'LOGIX_cas2_pwp_llpl.cas2_pwp_llpl.MX02_REWORK_600kg', 1), // rework active

  // ----------------------------------------------------------------- SILO ----
  row('800500104346-1', 'TSPCAS3.Cascade3.Day_silo_1_type_of_noodle', 'JASMINE NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Day_silo_2_type_of_noodle', 'PLUMERIA NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Day_silo_3_type_of_noodle', 'SERGIO 56 NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Day_silo_4_type_of_noodle', 'JASMINE NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Day_silo_5_type_of_noodle', 'GALAXY NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Day_silo_6_type_of_noodle', 'PLUMERIA NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Buffer_silo_1_type_of_noodle', 'JASMINE NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Buffer_silo_2_type_of_noodle', 'TEXAS MOD NOODLES'), // mismatch vs Day 2
  row('800500104346-1', 'TSPCAS3.Cascade3.Buffer_silo_3_type_of_noodle', 'SERGIO 56 NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Buffer_silo_4_type_of_noodle', 'JASMINE NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Buffer_silo_5_type_of_noodle', 'GALAXY NOODLES'),

  row('800500104343-1', 'TSPCAS3.Cascade3.Bagout_Stn_01_All_Details',
    'B40231,850.00,842.50,JASMINE NOODLES'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Bagout_Stn_02_All_Details', ','), // idle
  row('800500104346-1', 'TSPCAS3.Cascade3.Bagout_Stn_01_Scnr_barcode', '90017734'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Bagout_Stn_02_Scnr_barcode', ''),
  row('800500104346-1', 'TSPCAS3.Cascade3.Company_warehouse_bag_Dosing_Barcode',
    'B40231,825.50,JASMINE NOODLES,4'),
  row('800500104346-1', 'TSPCAS3.Cascade3.Shreeji_NEW_BARCODE_and_WEIGHT',
    'SHRJ778120,0,18.40'),

  // ------------------------------------------------------------ PACKAGING ----
  // Cascade 3
  row('8005000043300', 'TSPCAS3.Cascade3.WRA2_CURRENT_SOAP_GRAM', 100),
  row('8005000043300', 'TSPCAS3.Cascade3.WRA4_CURRENT_SOAP_GRAM', 101),
  row('8005000043300', 'TSPCAS3.Cascade3.WRA5_CURRENT_SOAP_GRAM', 149),
  row('8005000043300', 'TSPCAS3.Cascade3.WRA6_CURRENT_SOAP_GRAM', 150),
  row('8005000043300', 'TSPCAS3.Cascade3.WRA7_CURRENT_SOAP_GRAM', 125),
  row('8005000043300', 'TSPCAS3.Cascade3.WRA8_CURRENT_SOAP_GRAM', 124),
  row('8005000043300', 'TSPCAS3.Cascade3.WRA9_CURRENT_SOAP_GRAM', 130), // +5g > limit
  row('800500104343-1', 'TSPCAS3.Cascade3.WRA3_CURRENT_SOAP_GRAM', 100),
  row('800500104343-1', 'TSPCAS3.Cascade3.ACMA1_CURRENT_SOAP_GRAM', 40),
  // Cascade 5_6
  row('8005000043300', 'NEW_TSP.CAS5_6.WRA10_CURRENT_SOAP_GRAM', 41),
  row('8005000043300', 'NEW_TSP.CAS5_6.WRA11_CURRENT_SOAP_GRAM', 41),
  row('8005000043300', 'NEW_TSP.CAS5_6.WRA12_CURRENT_SOAP_GRAM', 42),
  row('8005000043300', 'NEW_TSP.CAS5_6.WRA13_CURRENT_SOAP_GRAM', 39),
  row('8005000043300', 'NEW_TSP.CAS5_6.WRA14_CURRENT_SOAP_GRAM', 39),
  row('8005000043300', 'NEW_TSP.CAS5_6.WRA15_CURRENT_SOAP_GRAM', 0), // offline
  row('800500005279-0', 'NEW_TSP.CAS5_6.WRA16_CURRENT_SOAP_GRAM', 39),
];
