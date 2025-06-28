export interface AircraftData {
  now: number;
  messages: number;
  aircraft: Aircraft[];
}

export interface Aircraft {
  hex: string;
  type: string;
  flight?: string;
  alt_baro?: number;
  alt_geom?: number;
  gs?: number;
  ias?: number;
  tas?: number;
  mach?: number;
  wd?: number;
  ws?: number;
  oat?: number;
  tat?: number;
  track?: number;
  track_rate?: number;
  roll?: number;
  mag_heading?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  nav_qnh?: number;
  nav_altitude_mcp?: number;
  nav_altitude_fms?: number;
  nav_heading?: number;
  nav_modes?: string[];
  lat?: number;
  lon?: number;
  nic?: number;
  rc?: number;
  seen_pos?: number;
  version?: number;
  nic_baro?: number;
  nac_p?: number;
  nac_v?: number;
  sil?: number;
  sil_type?: string;
  gva?: number;
  sda?: number;
  alert?: number;
  spi?: number;
  mlat: any[];
  tisb: any[];
  messages: number;
  seen: number;
  rssi: number;
  lastPosition?: LastPosition;
  gpsOkBefore?: number;
  gpsOkLat?: number;
  gpsOkLon?: number;
}

export interface LastPosition {
  lat: number;
  lon: number;
  nic: number;
  rc: number;
  seen_pos: number;
}

export interface AntennaConfig {
  id: string;
  url: string;
  enabled: boolean;
}
