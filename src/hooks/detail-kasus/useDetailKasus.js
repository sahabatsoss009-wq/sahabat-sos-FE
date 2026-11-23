import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { laporanService } from '../../api/services/laporanService';
import { adminService } from '../../api/services/adminService';
import { kasusAktifService } from '../../api/services/kasusAktifService';
import echo from '../../api/libs/echo';
import { normaliseKasus } from './normaliseKasus';

/**
 * useDetailKasus
 * Hook utama untuk halaman DetailKasusPage.
 * Mendukung dua tipe kasus:
 *   - 'laporan'  (default)
 *   - 'sos'      (via ?tipe=sos)
 */
export function useDetailKasus() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tipe = (searchParams.get('tipe') ?? 'laporan').toLowerCase(); // 'sos' | 'laporan'

  // --- Data State ---
  const [kasus, setKasus] = useState(null);
  const [relawanList, setRelawanList] = useState([]);
  const [activities, setActivities] = useState([]);
  const kasusRef = useRef(null);

  // --- Loading State ---
  const [loadingKasus, setLoadingKasus] = useState(true);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingRelawan, setLoadingRelawan] = useState(false);
  const [loadingDispatch, setLoadingDispatch] = useState(false);
  const [loadingSelesai, setLoadingSelesai] = useState(false);
  const [loadingTangani, setLoadingTangani] = useState(false);

  // --- Error State ---
  const [errorKasus, setErrorKasus] = useState('');

  // --- UI State ---
  const [selectedRelawanId, setSelectedRelawanId] = useState(null);
  const [showDispatchPanel, setShowDispatchPanel] = useState(false);
  const [showSelesaiModal, setShowSelesaiModal] = useState(false);
  const [catatanSelesai, setCatatanSelesai] = useState('');

  // --- Feedback State ---
  const [feedback, setFeedback] = useState(null);

  const showFeedback = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Pengambilan data aktivitas kasus
  const fetchActivities = useCallback(async () => {
    if (!id) return;
    // Audit timeline s_o_s_activities khusus kasus SOS (bukan Laporan)
    if (tipe !== 'sos') {
      setActivities([]);
      return;
    }
    try {
      setLoadingActivities(true);
      const res = await adminService.getSosActivities(id);
      const data = res?.data ?? res?.activities ?? (Array.isArray(res) ? res : []);
      setActivities(Array.isArray(data) ? data : []);
    } catch {
      // Graceful fallback jika bukan SOS atau belum ada log
      setActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  }, [id, tipe]);

  // Pengambilan data relawan terdekat untuk dispatch dan peta
  const fetchRelawanDispatch = useCallback(async (customLat, customLng) => {
    try {
      setLoadingRelawan(true);
      const latVal = customLat ?? kasusRef.current?.latitude;
      const lngVal = customLng ?? kasusRef.current?.longitude;
      const params = {
        id,
        tipe,
        lat: latVal,
        lng: lngVal,
      };
      const res = await adminService.getQuickDispatchRelawan(params);
      const items = res?.data ?? [];
      setRelawanList(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error('[useDetailKasus] fetchRelawanDispatch:', err);
      setRelawanList([]);
    } finally {
      setLoadingRelawan(false);
    }
  }, [id, tipe]);

  // Pengambilan detail kasus dari backend
  const fetchKasus = useCallback(async (options = {}) => {
    if (!id) return;
    const isSilent = typeof options === 'boolean' ? options : Boolean(options?.silent);
    try {
      // Hanya aktifkan spinner jika data kasus belum ada di layar
      if (!isSilent && (!kasusRef.current || String(kasusRef.current.id) !== String(id))) {
        setLoadingKasus(true);
      }
      setErrorKasus('');

      let raw;
      try {
        const res = await kasusAktifService.getDetail(tipe, id);
        raw = res?.data ?? res;
      } catch (err) {
        // Fallback untuk laporan lama
        if (tipe === 'laporan') {
          const res = await laporanService.getDetailLaporan(id);
          raw = res?.data ?? res;
        } else {
          throw err;
        }
      }

      const normalized = normaliseKasus(raw, tipe);
      kasusRef.current = normalized;
      setKasus(normalized);
      await fetchActivities();
      fetchRelawanDispatch(normalized?.latitude, normalized?.longitude);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Gagal memuat detail kasus.';
      setErrorKasus(msg);
      console.error('[useDetailKasus] fetchKasus:', err);
    } finally {
      setLoadingKasus(false);
    }
  }, [id, tipe, fetchActivities, fetchRelawanDispatch]);

  // Penugasan relawan
  const handleDispatch = async () => {
    if (!selectedRelawanId) return;
    try {
      setLoadingDispatch(true);
      await kasusAktifService.dispatchRelawan(tipe, id, selectedRelawanId);
      showFeedback('success', 'Relawan berhasil ditugaskan ke kasus ini.');
      setShowDispatchPanel(false);
      setSelectedRelawanId(null);
      await fetchKasus({ silent: true });
      window.dispatchEvent(new CustomEvent('kasus-updated'));
    } catch (err) {
      const msg = err?.response?.data?.message || 'Gagal menugaskan relawan.';
      showFeedback('error', msg);
      console.error('[useDetailKasus] handleDispatch:', err);
    } finally {
      setLoadingDispatch(false);
    }
  };

  // Ambil alih / penanganan kasus langsung oleh admin
  const handleTanganiKasus = async (catatan = null) => {
    try {
      setLoadingTangani(true);
      await kasusAktifService.tanganiKasus(tipe, id, catatan);
      showFeedback('success', 'Kasus berhasil diambil alih dan ditangani.');
      await fetchKasus({ silent: true });
      window.dispatchEvent(new CustomEvent('kasus-updated'));
    } catch (err) {
      const msg = err?.response?.data?.message || 'Gagal mengambil alih kasus.';
      showFeedback('error', msg);
      console.error('[useDetailKasus] handleTanganiKasus:', err);
    } finally {
      setLoadingTangani(false);
    }
  };

  // Penyelesaian kasus
  const handleSelesai = async () => {
    try {
      setLoadingSelesai(true);
      await kasusAktifService.selesaikanKasus(
        tipe,
        id,
        catatanSelesai || 'Kasus ditandai selesai oleh admin.'
      );
      showFeedback('success', 'Kasus berhasil ditandai selesai.');
      setShowSelesaiModal(false);
      setCatatanSelesai('');
      await fetchKasus({ silent: true });
      window.dispatchEvent(new CustomEvent('kasus-updated'));
    } catch (err) {
      const msg = err?.response?.data?.message || 'Gagal menyelesaikan kasus.';
      showFeedback('error', msg);
      console.error('[useDetailKasus] handleSelesai:', err);
    } finally {
      setLoadingSelesai(false);
    }
  };

  // Pencatatan log aksi kritis
  const handleLogAksi = async (actionType) => {
    try {
      await adminService.logAksiKritis(id, { action: actionType });
      showFeedback('success', `Aksi menghubungi ${actionType} telah dicatat ke log.`);
      await fetchActivities();
    } catch (err) {
      showFeedback('error', 'Gagal mencatat log aktivitas.');
      console.error('[useDetailKasus] handleLogAksi:', err);
    }
  };

  // Perbaruan status laporan warga
  const handleUpdateStatusLaporan = async (status) => {
    try {
      setLoadingSelesai(true);
      await laporanService.updateStatus(id, status);
      showFeedback('success', `Status laporan berhasil diubah menjadi "${status}".`);
      await fetchKasus({ silent: true });
    } catch (err) {
      const msg = err?.response?.data?.message || 'Gagal mengubah status laporan.';
      showFeedback('error', msg);
      console.error('[useDetailKasus] handleUpdateStatusLaporan:', err);
    } finally {
      setLoadingSelesai(false);
    }
  };

  // Buka panel penugasan relawan
  const handleOpenDispatchPanel = () => {
    setShowDispatchPanel(true);
    fetchRelawanDispatch();
  };

  useEffect(() => {
    fetchKasus();
  }, [fetchKasus]);

  // Listener WebSocket real-time untuk command center
  useEffect(() => {
    if (!id) return;
    const channel = echo.private('command-center');

    // 1. Sinkronisasi pergerakan relawan secara real-time
    const handleRelawanLocation = (data) => {
      if (!data?.relawan_id) return;

      setKasus((prev) => {
        if (!prev) return prev;
        const isAssigned = prev.relawan && String(prev.relawan.id) === String(data.relawan_id);
        const matchesSos = data.sos_id && String(data.sos_id) === String(prev.id);

        if (isAssigned || matchesSos) {
          return {
            ...prev,
            relawan: {
              ...(prev.relawan || {}),
              id: data.relawan_id,
              name: data.nama || prev.relawan?.name,
              latitude: parseFloat(data.latitude),
              longitude: parseFloat(data.longitude),
            },
          };
        }
        return prev;
      });

      // Perbarui juga data relawan di daftar dispatch dan peta sekitar
      setRelawanList((prev) =>
        prev.map((r) => {
          if (String(r.id) === String(data.relawan_id)) {
            return {
              ...r,
              latitude: parseFloat(data.latitude),
              longitude: parseFloat(data.longitude),
              status: data.status || r.status,
              jarak_km: data.distance != null ? Number(data.distance).toFixed(1) : r.jarak_km,
              jarak_text: data.distance != null ? `${Number(data.distance).toFixed(1)} km` : r.jarak_text,
            };
          }
          return r;
        })
      );
    };

    // 2. Sinkronisasi status kasus SOS
    const handleStatusUpdate = (data) => {
      if (!data?.id || String(data.id) !== String(id)) return;

      setKasus((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: data.status_sos || prev.status,
          status_raw: data.status_sos || prev.status_raw,
          relawan: data.relawan ?? prev.relawan,
          updated_at: data.updated_at || prev.updated_at,
        };
      });

      // Muat ulang aktivitas linimasa secara hening (silent)
      fetchActivities();
    };

    channel.listen('.RelawanLocationUpdate', handleRelawanLocation);
    channel.listen('RelawanLocationUpdate', handleRelawanLocation);

    channel.listen('.SOSUpdateStatus', handleStatusUpdate);
    channel.listen('SOSUpdateStatus', handleStatusUpdate);

    // Dengarkan event SOSCreated untuk mendeteksi auto-eskalasi atau mutasi darurat
    const handleSosCreated = () => {
      fetchActivities();
    };
    channel.listen('.SOSCreated', handleSosCreated);
    channel.listen('SOSCreated', handleSosCreated);

    const handleRelawanStatus = () => {
      fetchRelawanDispatch();
    };
    channel.listen('.RelawanStatusUpdated', handleRelawanStatus);
    channel.listen('RelawanStatusUpdated', handleRelawanStatus);

    return () => {
      channel.stopListening('.RelawanLocationUpdate', handleRelawanLocation);
      channel.stopListening('RelawanLocationUpdate', handleRelawanLocation);
      channel.stopListening('.SOSUpdateStatus', handleStatusUpdate);
      channel.stopListening('SOSUpdateStatus', handleStatusUpdate);
      channel.stopListening('.SOSCreated', handleSosCreated);
      channel.stopListening('SOSCreated', handleSosCreated);
      channel.stopListening('.RelawanStatusUpdated', handleRelawanStatus);
      channel.stopListening('RelawanStatusUpdated', handleRelawanStatus);
    };
  }, [id, fetchActivities, fetchRelawanDispatch]);

  return {
    id,
    tipe,
    kasus,
    activities,
    relawanList,
    loadingKasus,
    loadingActivities,
    loadingRelawan,
    loadingDispatch,
    loadingSelesai,
    loadingTangani,
    errorKasus,
    selectedRelawanId,
    setSelectedRelawanId,
    showDispatchPanel,
    setShowDispatchPanel,
    showSelesaiModal,
    setShowSelesaiModal,
    catatanSelesai,
    setCatatanSelesai,
    feedback,
    navigate,
    fetchKasus,
    handleDispatch,
    handleTanganiKasus,
    handleSelesai,
    handleLogAksi,
    handleOpenDispatchPanel,
    handleUpdateStatusLaporan,
  };
}
