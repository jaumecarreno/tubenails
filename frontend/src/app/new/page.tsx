"use client";
import { useEffect, useState } from 'react';
import axios from '@/lib/axios';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CreateTestPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);

    // Form State
    const [videoId, setVideoId] = useState('');
    const [titleA, setTitleA] = useState('Título original (Se importará de YouTube)');
    const [titleB, setTitleB] = useState('');
    const [durationDays, setDurationDays] = useState(7);
    const [thumbnailA, setThumbnailA] = useState('');
    const [thumbnailB, setThumbnailB] = useState('');

    const [recentVideos, setRecentVideos] = useState<any[]>([]);
    const [fetchingVideos, setFetchingVideos] = useState(true);

    // Fetch initial channel videos
    useEffect(() => {
        async function loadVideos() {
            try {
                const res = await axios.get('/api/youtube/videos');
                setRecentVideos(res.data);
            } catch (err) {
                console.error("Warning: Could not fetch recent videos", err);
            } finally {
                setFetchingVideos(false);
            }
        }
        loadVideos();
    }, []);

    const handleSelectVideo = (video: any) => {
        setVideoId(video.videoId);
        setTitleA(video.title);
        setThumbnailA(video.thumbnailUrl);
        setThumbnailB(video.thumbnailUrl);
    };

    const handleImport = async () => {
        if (!videoId) return;
        try {
            setImporting(true);
            const response = await axios.get(`/api/youtube/video/${videoId}`);
            const { title, thumbnailUrl } = response.data;
            if (title) setTitleA(title);
            if (thumbnailUrl) {
                setThumbnailA(thumbnailUrl);
                setThumbnailB(thumbnailUrl);
            }
        } catch (error) {
            console.error("Error importing video", error);
            alert("No se pudo descargar el vídeo de YouTube. ¿El ID es correcto y tu cuenta está conectada en Ajustes?");
        } finally {
            setImporting(false);
        }
    };

    const handleSubmit = async () => {
        if (!videoId) {
            alert("Por favor, selecciona un vídeo de tu canal o pega un ID válido antes de continuar.");
            return;
        }

        try {
            setLoading(true);
            const payload = {
                videoId: videoId,
                titleA,
                titleB,
                thumbnailA,
                thumbnailB,
                durationDays
            };

            await axios.post('/api/tests', payload);

            // Redirect to dashboard on success
            router.push('/');
        } catch (error) {
            console.error("Error creating test", error);
            alert("No se pudo crear el test A/B. ¿Estás logueado en la base de datos?");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 w-full max-w-[840px] mx-auto px-4 py-8 pb-32 overflow-y-auto">
            {/* Page Header */}
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <Link className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors mb-2 group" href="/">
                        <span className="material-symbols-outlined text-[18px] group-hover:-translate-x-1 transition-transform">chevron_left</span>
                        Volver al Dashboard
                    </Link>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Configurar Nuevo Test A/B</h2>
                    <p className="text-slate-500 dark:text-gray-400 mt-1">Maximiza tu CTR comparando miniaturas y títulos con precisión estadística.</p>
                </div>
            </div>

            {/* STEP 1: Video Selection */}
            <section className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-6 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">1</div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">¿Qué vídeo quieres optimizar?</h3>
                </div>

                <div className="space-y-6">
                    {/* Search Input */}
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                            <span className="material-symbols-outlined">link</span>
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-10 pr-3 py-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-surface-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition duration-150 sm:text-sm"
                            placeholder="Pega la URL del vídeo aquí (ID)"
                            value={videoId}
                            onChange={(e) => setVideoId(e.target.value)}
                        />
                        <button
                            type="button"
                            onClick={handleImport}
                            disabled={importing || !videoId}
                            className="absolute inset-y-1 right-1 px-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-xs font-medium rounded text-slate-700 dark:text-gray-300 transition-colors disabled:opacity-50"
                        >
                            {importing ? "..." : "Importar"}
                        </button>
                    </div>

                    {/* Recent Videos Carousel */}
                    <div>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tus Últimos Vídeos</span>
                            <div className="flex gap-2">
                                <a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-lg border border-transparent bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                                    <span className="material-symbols-outlined mr-1.5 text-[16px]">open_in_new</span>
                                    YouTube Studio
                                </a>
                                <a href="https://youtube.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-lg border border-transparent bg-red-50 dark:bg-red-900/20 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                                    <span className="material-symbols-outlined mr-1.5 text-[16px]">play_circle</span>
                                    YouTube
                                </a>
                            </div>
                        </div>

                        {fetchingVideos ? (
                            <div className="flex items-center justify-center p-8 bg-slate-50 dark:bg-surface-dark-hover rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                <span className="animate-spin material-symbols-outlined text-slate-400 mr-2">sync</span>
                                <span className="text-sm text-slate-500">Cargando catálogo...</span>
                            </div>
                        ) : recentVideos.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 custom-scrollbar max-h-[360px] overflow-y-auto p-1">
                                {recentVideos.map((video) => (
                                    <div
                                        key={video.videoId}
                                        onClick={() => handleSelectVideo(video)}
                                        className={`relative group cursor-pointer border-2 bg-slate-50 dark:bg-surface-dark-hover rounded-lg overflow-hidden transition-all shadow-sm hover:shadow-md ${videoId === video.videoId ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-primary/50'}`}
                                    >
                                        {videoId === video.videoId && (
                                            <div className="absolute top-2 right-2 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full z-10 shadow-sm">
                                                SELECCIONADO
                                            </div>
                                        )}
                                        <div className="aspect-video w-full bg-cover bg-center" style={{ backgroundImage: `url('${video.thumbnailUrl}')` }}></div>
                                        <div className="p-3">
                                            <p className="text-sm font-medium text-slate-900 dark:text-white line-clamp-2" title={video.title}>{video.title}</p>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className="text-[11px] text-slate-500">
                                                    {new Date(video.publishedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center p-8 bg-slate-50 dark:bg-surface-dark-hover rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                <div className="mx-auto w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-3">
                                    <span className="material-symbols-outlined">videocam_off</span>
                                </div>
                                <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">No hay vídeos disponibles</p>
                                <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">Conecta tu cuenta de YouTube en la pantalla de Configuración para importar tus últimos subidos o pega manualmente un ID.</p>
                                <Link href="/settings" className="mx-auto inline-flex items-center text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-md hover:bg-red-100 transition-colors">
                                    Ir a Configuración
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* STEP 2: Define Variants */}
            <section className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-6 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">2</div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Define tus Variantes</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Variant A (Control) */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                Variante A (Control)
                            </span>
                            <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded">Solo Lectura</span>
                        </div>
                        <div className="relative aspect-video w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${thumbnailA}')` }}></div>
                            <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-medium px-1.5 py-0.5 rounded">12:45</div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Título del Video</label>
                            <input type="text" disabled className="block w-full px-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-surface-dark-hover text-slate-500 dark:text-slate-400 text-sm cursor-not-allowed opacity-75" value={titleA} />
                        </div>
                    </div>

                    {/* Variant B (Test) */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                                Variante B (Test)
                            </span>
                            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">Editable</span>
                        </div>

                        {/* URL Input & Preview */}
                        <div className="relative aspect-video w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-surface-dark flex items-center justify-center">
                            {thumbnailB ? (
                                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${thumbnailB}')` }}></div>
                            ) : (
                                <span className="material-symbols-outlined text-4xl text-slate-300">image</span>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">URL de la Miniatura</label>
                            <input
                                type="text"
                                className="block w-full px-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-surface-dark-hover text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition duration-150 text-sm"
                                placeholder="https://ejemplo.com/imagen.jpg"
                                value={thumbnailB}
                                onChange={(e) => setThumbnailB(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Nuevo Título (Opcional)</label>
                            <input
                                type="text"
                                className="block w-full px-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-surface-dark-hover text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition duration-150 text-sm"
                                placeholder="Escribe un título alternativo..."
                                value={titleB}
                                onChange={(e) => setTitleB(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* STEP 3: Duration & Submit */}
            <section className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">3</div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Duración del Test</h3>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 grid grid-cols-3 gap-3">
                        <label className="cursor-pointer">
                            <input type="radio" name="duration" value="4" className="peer sr-only" checked={durationDays === 4} onChange={() => setDurationDays(4)} />
                            <div className="flex flex-col items-center justify-center p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-surface-dark-hover peer-checked:bg-primary/10 peer-checked:border-primary peer-checked:text-primary transition-all h-full">
                                <span className="text-lg font-bold">4</span>
                                <span className="text-xs font-medium uppercase tracking-wide">Días</span>
                            </div>
                        </label>
                        <label className="cursor-pointer">
                            <input type="radio" name="duration" value="7" className="peer sr-only" checked={durationDays === 7} onChange={() => setDurationDays(7)} />
                            <div className="flex flex-col items-center justify-center p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-surface-dark-hover peer-checked:bg-primary/10 peer-checked:border-primary peer-checked:text-primary transition-all h-full">
                                <span className="text-lg font-bold">7</span>
                                <span className="text-xs font-medium uppercase tracking-wide">Días</span>
                            </div>
                        </label>
                        <label className="cursor-pointer">
                            <input type="radio" name="duration" value="14" className="peer sr-only" checked={durationDays === 14} onChange={() => setDurationDays(14)} />
                            <div className="flex flex-col items-center justify-center p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-surface-dark-hover peer-checked:bg-primary/10 peer-checked:border-primary peer-checked:text-primary transition-all h-full">
                                <span className="text-lg font-bold">14</span>
                                <span className="text-xs font-medium uppercase tracking-wide">Días</span>
                            </div>
                        </label>
                    </div>

                    <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex gap-3">
                        <span className="material-symbols-outlined text-blue-500 shrink-0">info</span>
                        <div className="text-sm">
                            <p className="font-medium text-slate-900 dark:text-blue-100 mb-1">Metodología de Rotación</p>
                            <p className="text-slate-500 dark:text-blue-200/70 text-xs leading-relaxed">
                                El sistema rotará la miniatura y título cada 24h a media noche (UTC) asignando exposición homogénea.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className={`flex items-center justify-center gap-2 text-white font-bold py-3 px-8 rounded-lg shadow-lg shadow-primary/30 transition-all ${loading ? 'bg-red-400 cursor-not-allowed' : 'bg-primary hover:bg-red-600 hover:scale-[1.02]'}`}
                    >
                        {loading && <span className="animate-spin material-symbols-outlined">sync</span>}
                        {loading ? 'Creando Test DB...' : 'Iniciar Test A/B Ahora'}
                    </button>
                </div>
            </section>
        </div>
    );
}
