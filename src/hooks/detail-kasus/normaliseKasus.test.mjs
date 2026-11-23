import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseKasus } from './normaliseKasus.js';

test('normaliseKasus preserves mobile and Tuya telemetry for active SOS', () => {
  const raw = {
    id: 42,
    status_raw: 'belum ditangani',
    jenis_laporan: 'Darurat SOS',
    lokasi: { alamat: 'Jl. Malioboro', latitude: -7.7925, longitude: 110.3658 },
    pelapor: { id: 7, name: 'Budi', no_telp: '081234567890', kontak_darurat: [] },
    battery_level: 85,
    signal_strength: '4G',
    device_info: {
      is_online: true,
      mobile: {
        brand: 'Samsung',
        model: 'Galaxy A54',
        os_version: 'Android 14',
        battery_level: 85,
        is_charging: false,
        signal_strength: '4G',
      },
      tuya: {
        device_id: 'tuya_btn_01',
        device_name: 'Tombol Darurat Ruang Tamu',
        battery_level: 15,
        is_battery_low: true,
        is_online: true,
        signal_strength: 'Bagus',
      },
    },
  };

  const result = normaliseKasus(raw, 'sos');

  assert.equal(result.device_info.trigger_source, 'tuya_physical_button');
  assert.equal(result.device_info.is_warning, true);
  assert.equal(result.device_info.mobile.brand, 'Samsung');
  assert.equal(result.device_info.tuya.device_id, 'tuya_btn_01');
  assert.equal('smartwatch' in result.device_info, false);
  assert.equal('smartband' in result.device_info, false);
  assert.equal('heart_rate' in result.device_info, false);
  assert.equal('bpm' in result.device_info, false);
});

test('normaliseKasus strips legacy smartwatch and heart-rate keys from historical SOS JSON', () => {
  const raw = {
    id: 99,
    status_raw: 'selesai',
    jenis_laporan: 'Darurat SOS',
    lokasi: { alamat: 'Jl. Kaliurang', latitude: -7.75, longitude: 110.38 },
    pelapor: { id: 8, name: 'Siti', no_telp: '081299998888', kontak_darurat: [] },
    heart_rate: 142,
    device_info: {
      trigger_source: 'smartband_heart_rate',
      is_online: true,
      heart_rate: 142,
      bpm: 142,
      mobile: {
        brand: 'Xiaomi',
        model: 'Redmi Note 12',
        battery_level: 64,
        signal_strength: '4G',
      },
      tuya: {
        device_id: 'tuya_btn_99',
        device_name: 'Tombol SOS',
        battery_level: 90,
        is_battery_low: false,
        is_online: true,
      },
      smartwatch: {
        device_id: 'hw_band_7',
        device_name: 'Huawei Band 7',
        heart_rate: 142,
        fall_detected: true,
        is_battery_low: true,
      },
      smartband: {
        device_id: 'hw_band_7',
        bpm: 142,
      },
    },
  };

  const result = normaliseKasus(raw, 'sos');

  assert.equal(result.device_info.mobile.brand, 'Xiaomi');
  assert.equal(result.device_info.tuya.device_id, 'tuya_btn_99');
  assert.equal(result.device_info.is_warning, false);
  assert.equal('smartwatch' in result.device_info, false);
  assert.equal('smartband' in result.device_info, false);
  assert.equal('heart_rate' in result.device_info, false);
  assert.equal('bpm' in result.device_info, false);
});
