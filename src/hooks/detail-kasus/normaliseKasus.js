/**
 * Helper memformat nomor HP ke format internasional WhatsApp (62xxx)
 */
function formatWhatsAppNumber(phone) {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('62')) return cleaned;
  if (cleaned.startsWith('0')) return '62' + cleaned.substring(1);
  return '62' + cleaned;
}

const STRIPPED_WEARABLE_KEYS = new Set([
  'smartwatch',
  'smartband',
  'heart_rate',
  'bpm',
]);

function filterLegacyWearableKeys(rawDev) {
  if (!rawDev || typeof rawDev !== 'object') return {};
  return Object.fromEntries(
    Object.entries(rawDev).filter(([key]) => !STRIPPED_WEARABLE_KEYS.has(key))
  );
}

/**
 * Normalises different API response formats into a unified shape
 * expected by DetailKasusPage:
 *
 * Supports responses from:
 *   - GET /tugas-aktif/{tipe}/{id} (KasusAktifController::show)
 *   - GET /laporan/{id} (LaporanController::show fallback)
 */
export function normaliseKasus(raw, tipe) {
  if (!raw) return null;

  const isTugasAktifFormat = Boolean(
    raw.lokasi?.alamat !== undefined ||
    raw.pelapor !== undefined ||
    raw.jenis_laporan !== undefined
  );

  if (isTugasAktifFormat) {
    const pelapor = raw.pelapor ?? null;
    const rawKontak = Array.isArray(pelapor?.kontak_darurat) ? pelapor.kontak_darurat : [];
    const formattedKontak = rawKontak.map((k) => {
      const waNumber = formatWhatsAppNumber(k.no_telp);
      return {
        id:           k.id,
        nama:         k.nama,
        no_telp:      k.no_telp,
        hubungan:     k.hubungan ?? 'Keluarga',
        email:        k.email ?? null,
        tipe:         k.tipe ?? 'utama',
        is_utama:     k.is_utama ?? (k.tipe === 'utama'),
        pesan_khusus: k.pesan_khusus ?? k.pesan ?? null,
        whatsapp_url: k.whatsapp_url || (waNumber ? `https://wa.me/${waNumber}` : null),
      };
    });

    const kontakUtama = pelapor?.kontak_darurat_utama ??
      formattedKontak.find((k) => k.is_utama) ??
      formattedKontak[0] ??
      null;

    const userWa = pelapor?.no_telp_wa || formatWhatsAppNumber(pelapor?.no_telp);

    const rawDev = (typeof raw.device_info === 'object' && raw.device_info !== null) ? raw.device_info : null;
    const rawMobile = rawDev?.mobile ?? (rawDev && (rawDev.brand || rawDev.device_model || rawDev.model) ? rawDev : null);
    const rawTuya = rawDev?.tuya ?? null;

    const batLevel = rawMobile?.battery_level ?? raw.battery_level ?? rawDev?.battery_level ?? null;
    const sigStrength = rawMobile?.signal_strength ?? raw.signal_strength ?? rawDev?.signal_strength ?? null;
    const isOnline = rawDev?.is_online ?? rawMobile?.is_online ?? null;

    const hasSosTelemetry = tipe === 'sos' && (
      batLevel != null ||
      sigStrength != null ||
      isOnline != null ||
      rawTuya != null ||
      Boolean(rawMobile && (rawMobile.brand || rawMobile.model || rawMobile.device_model))
    );

    return {
      id:               raw.id,
      status:           raw.status_raw ?? raw.status,
      urgensi:          raw.urgensi ?? null,
      kategori_laporan: raw.jenis_laporan ?? raw.sub_judul ?? (tipe === 'sos' ? 'Darurat SOS' : 'Laporan'),
      deskripsi:        raw.deskripsi ?? '',
      lokasi_laporan:   raw.lokasi?.alamat ?? '',
      latitude:         raw.lokasi?.latitude ?? raw.latitude ?? raw.lat ?? null,
      longitude:        raw.lokasi?.longitude ?? raw.longitude ?? raw.lng ?? null,
      waktu_laporan:    raw.waktu ?? null,
      foto_laporan_url: raw.foto_laporan_url ?? null,
      rekam_suara_url:  raw.rekam_suara_url ?? null,
      catatan_penanganan: Array.isArray(raw.catatan_penanganan) ? raw.catatan_penanganan : [],
      pengguna: pelapor ? {
        id:                      pelapor.id,
        name:                    pelapor.name,
        email:                   pelapor.email ?? null,
        no_telp:                 pelapor.no_telp,
        no_telp_wa:              userWa,
        whatsapp_url:            pelapor.whatsapp_url || (userWa ? `https://wa.me/${userWa}` : null),
        foto_url:                pelapor.foto_profile ?? null,
        kategori_user:           pelapor.kategori_user ?? null,
        jenis_disabilitas:       pelapor.jenis_disabilitas ?? pelapor.kategori_user ?? null,
        metode_komunikasi:       pelapor.metode_komunikasi ?? null,
        kebutuhan_aksesibilitas: pelapor.kebutuhan_aksesibilitas ?? null,
        keterangan_medis:        pelapor.keterangan_medis ?? null,
        kontak_darurat:          formattedKontak,
        kontak_darurat_utama:    kontakUtama,
      } : null,
      relawan: raw.relawan ? {
        id:        raw.relawan.id,
        name:      raw.relawan.name,
        no_telp:   raw.relawan.no_telp,
        foto_url:  raw.relawan.foto_profile ?? null,
        latitude:  raw.relawan.latitude !== null && raw.relawan.latitude !== undefined ? Number(raw.relawan.latitude) : null,
        longitude: raw.relawan.longitude !== null && raw.relawan.longitude !== undefined ? Number(raw.relawan.longitude) : null,
      } : null,
      device_info: hasSosTelemetry ? (() => {
        const mobile = rawMobile ? {
          brand: rawMobile.brand ?? rawDev?.brand ?? null,
          model: rawMobile.model ?? rawMobile.device_model ?? rawDev?.device_model ?? rawDev?.model ?? null,
          os_version: rawMobile.os_version ?? rawDev?.os_version ?? null,
          battery_level: batLevel,
          battery_status: rawMobile.battery_status || (batLevel != null ? (batLevel < 20 ? 'Kritis' : 'Baik') : null),
          is_charging: rawMobile.is_charging ?? rawDev?.is_charging ?? false,
          battery_state: rawMobile.battery_state ?? rawDev?.battery_state ?? null,
          signal_strength: sigStrength,
          gps_accuracy: rawMobile.gps_accuracy ?? rawDev?.gps_accuracy ?? null,
          device_id: rawMobile.device_id ?? rawDev?.device_id ?? raw.device_id ?? null,
          is_online: isOnline,
        } : (batLevel != null || sigStrength != null) ? {
          brand: rawDev?.brand ?? null,
          model: rawDev?.device_model ?? rawDev?.model ?? null,
          os_version: rawDev?.os_version ?? null,
          battery_level: batLevel,
          battery_status: batLevel != null ? (batLevel < 20 ? 'Kritis' : 'Baik') : null,
          is_charging: rawDev?.is_charging ?? false,
          battery_state: rawDev?.battery_state ?? null,
          signal_strength: sigStrength,
          gps_accuracy: rawDev?.gps_accuracy ?? null,
          device_id: rawDev?.device_id ?? raw.device_id ?? null,
          is_online: isOnline,
        } : null;

        const tuya = rawTuya;
        const triggerSource = raw.trigger_source || rawDev?.trigger_source || (
          tuya ? 'tuya_physical_button' : (rawDev ? 'app_button' : null)
        );

        return {
          ...filterLegacyWearableKeys(rawDev),
          battery_level:       batLevel,
          battery_status:      mobile?.battery_status ?? (batLevel != null ? (batLevel < 20 ? 'Kritis' : 'Baik') : null),
          signal_strength:     sigStrength,
          is_online:           isOnline,
          device_id:           mobile?.device_id ?? rawDev?.device_id ?? raw.device_id ?? null,
          device_model:        mobile?.model ? `${mobile.brand || ''} ${mobile.model}`.trim() : (rawDev?.device_model || null),
          last_seen:           raw.last_seen ?? rawDev?.last_seen ?? null,
          location_updated_at: raw.location_updated_at ?? rawDev?.location_updated_at ?? null,
          trigger_source:      triggerSource,
          is_warning:          (batLevel != null && batLevel < 20) || Boolean(tuya && tuya.is_battery_low),
          mobile,
          tuya,
        };
      })() : null,
      _tipe: tipe,
    };
  }

  // Fallback dari GET /laporan/{id}: Laporan Eloquent model langsung
  const pengguna = raw.pengguna ?? null;
  const rawKontak = Array.isArray(pengguna?.kontak_darurat ?? pengguna?.kontakDarurat)
    ? (pengguna.kontak_darurat ?? pengguna.kontakDarurat)
    : [];
  const formattedKontak = rawKontak.map((k) => {
    const waNumber = formatWhatsAppNumber(k.no_telp);
    return {
      id:           k.id,
      nama:         k.nama,
      no_telp:      k.no_telp,
      hubungan:     k.hubungan ?? 'Keluarga',
      email:        k.email ?? null,
      tipe:         k.tipe ?? 'utama',
      is_utama:     k.is_utama ?? (k.tipe === 'utama'),
      pesan_khusus: k.pesan_khusus ?? k.pesan ?? null,
      whatsapp_url: k.whatsapp_url || (waNumber ? `https://wa.me/${waNumber}` : null),
    };
  });

  const userWa = formatWhatsAppNumber(pengguna?.no_telp);

  return {
    ...raw,
    kategori_laporan: raw.kategori_laporan || 'Laporan',
    lokasi_laporan:   raw.lokasi_laporan || '',
    latitude:         raw.lokasi?.latitude ?? raw.latitude ?? raw.lat ?? null,
    longitude:        raw.lokasi?.longitude ?? raw.longitude ?? raw.lng ?? null,
    waktu_laporan:    raw.waktu_laporan ?? raw.created_at ?? null,
    foto_laporan_url: raw.foto_laporan_url ?? (raw.foto_laporan ? `/storage/${raw.foto_laporan}` : null),
    rekam_suara_url:  raw.rekam_suara_url ?? (raw.rekam_suara ? `/storage/${raw.rekam_suara}` : null),
    catatan_penanganan: Array.isArray(raw.catatan_penanganan ?? raw.catatanPenanganan)
      ? (raw.catatan_penanganan ?? raw.catatanPenanganan)
      : [],
    pengguna: pengguna ? {
      ...pengguna,
      foto_url:          pengguna.foto_profile_url ?? pengguna.foto_url ?? pengguna.foto_profile ?? null,
      jenis_disabilitas: pengguna.jenis_disabilitas ?? pengguna.kategori_user ?? null,
      no_telp_wa:        userWa,
      whatsapp_url:      userWa ? `https://wa.me/${userWa}` : null,
      kontak_darurat:    formattedKontak,
      kontak_darurat_utama: formattedKontak.find((k) => k.is_utama) ?? formattedKontak[0] ?? null,
    } : null,
    relawan: raw.relawan ? {
      ...raw.relawan,
      foto_url:  raw.relawan.foto_profile_url ?? raw.relawan.foto_url ?? raw.relawan.foto_profile ?? null,
      latitude:  raw.relawan.latitude !== null && raw.relawan.latitude !== undefined ? Number(raw.relawan.latitude) : null,
      longitude: raw.relawan.longitude !== null && raw.relawan.longitude !== undefined ? Number(raw.relawan.longitude) : null,
    } : null,
    device_info: null,
    _tipe: tipe ?? 'laporan',
  };
}
