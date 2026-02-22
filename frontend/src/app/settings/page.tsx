"use client";

import { useEffect, useState } from 'react';
import axios from '@/lib/axios';
import Link from 'next/link';
import { UserSettingsResponse } from '@/lib/api-types';
import { useI18n } from '@/components/LanguageProvider';

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export default function SettingsPage() {
    const [userData, setUserData] = useState<UserSettingsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const { t } = useI18n();

    async function fetchSettings() {
        const response = await axios.get<UserSettingsResponse>(`/api/user/settings?t=${Date.now()}`);
        setUserData(response.data);
    }

    useEffect(() => {
        const load = async () => {
            try {
                await fetchSettings();
            } catch (error) {
                console.error('Failed fetching user settings', error);
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, []);

    const handleConnectYoutube = async () => {
        try {
            const response = await axios.get<{ url: string }>('/api/user/youtube/connect-url');
            window.location.href = response.data.url;
        } catch (error) {
            console.error('Failed to initialize YouTube connect flow', error);
            alert(t('settings.errorConnect', { message: getErrorMessage(error) }));
        }
    };

    const handleDisconnectYoutube = async () => {
        try {
            await axios.delete('/api/user/youtube');
            await fetchSettings();
        } catch (error) {
            console.error('Failed to disconnect YouTube account', error);
            alert(t('settings.errorDisconnect'));
        }
    };

    if (loading) {
        return (
            <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-20 text-center">
                <p className="text-slate-500 animate-pulse">{t('settings.loading')}</p>
            </div>
        );
    }

    const safeUserData = userData ?? {
        user: { id: '', email: '', plan: 'free', createdAt: '' },
        plan: 'free',
        isYoutubeConnected: false,
        channelId: '',
        usage: { activeTests: 0, totalTests: 0 }
    };
    const { user, isYoutubeConnected, usage, channelId, plan } = safeUserData;
    const planLabel = plan.toLowerCase() === 'pro' ? t('settings.plan.pro') : t('settings.plan.basic');
    const usagePercent = Math.min((usage.totalTests / 3) * 100, 100);

    return (
        <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-8 overflow-y-auto">
            <div className="mb-10">
                <Link href="/" className="group inline-flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-primary mb-4 transition-colors">
                    <span className="material-symbols-outlined text-[20px] group-hover:-translate-x-1 transition-transform">arrow_back</span>
                    {t('settings.backToDashboard')}
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{t('settings.title')}</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">{t('settings.subtitle')}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-7 flex flex-col gap-8">
                    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-red-500">video_library</span>
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('settings.youtube')}</h2>
                            </div>
                            {isYoutubeConnected ? (
                                <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:text-green-400 ring-1 ring-inset ring-green-600/20">
                                    {t('settings.connected')}
                                </span>
                            ) : (
                                <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/30 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:text-red-400 ring-1 ring-inset ring-red-600/20">
                                    {t('settings.disconnected')}
                                </span>
                            )}
                        </div>

                        {isYoutubeConnected ? (
                            <>
                                <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center p-4 rounded-lg bg-slate-50 dark:bg-surface-dark-hover border border-slate-100 dark:border-slate-700 mb-6">
                                    <div className="relative shrink-0">
                                        <div className="flex w-16 h-16 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-white dark:ring-offset-surface-dark ring-green-500 bg-red-100 text-red-600">
                                            <span className="material-symbols-outlined text-3xl">account_circle</span>
                                        </div>
                                        <div className="absolute -bottom-1 -right-1 flex w-6 h-6 items-center justify-center rounded-full bg-white dark:bg-surface-dark ring-2 ring-white dark:ring-surface-dark">
                                            <span className="material-symbols-outlined text-[16px] text-green-500 font-bold">check_circle</span>
                                        </div>
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-base font-bold text-slate-900 dark:text-white">{user.email || t('settings.userFallback')}</h3>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('settings.authorized')}</p>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center w-full">
                                    <div className="flex gap-2">
                                        <a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-lg border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                                            <span className="material-symbols-outlined mr-2 text-[18px]">open_in_new</span>
                                            YouTube Studio
                                        </a>
                                        <a href={channelId ? `https://youtube.com/channel/${channelId}` : 'https://youtube.com/'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-lg border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                            <span className="material-symbols-outlined mr-2 text-[18px]">play_circle</span>
                                            {t('settings.myChannel')}
                                        </a>
                                    </div>
                                    <button
                                        onClick={handleDisconnectYoutube}
                                        className="inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-transparent px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 shadow-sm hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800 transition-colors"
                                    >
                                        <span className="material-symbols-outlined mr-2 text-[18px]">link_off</span>
                                        {t('settings.disconnectChannel')}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-6">
                                <p className="text-slate-500 mb-4 text-sm">{t('settings.connectHint')}</p>
                                <button onClick={handleConnectYoutube} className="inline-flex items-center justify-center rounded-lg bg-red-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-red-700 transition-colors">
                                    <span className="material-symbols-outlined mr-2">video_library</span>
                                    {t('settings.connectYoutube')}
                                </button>
                            </div>
                        )}
                    </section>
                </div>

                <div className="lg:col-span-5 flex flex-col gap-8 sticky top-24">
                    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark overflow-hidden shadow-sm flex flex-col h-full">
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="material-symbols-outlined text-slate-400">credit_card</span>
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('settings.subscription')}</h2>
                            </div>
                            <div className="flex items-baseline justify-between mb-2">
                                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('settings.currentPlan')}</span>
                                <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-500/10">{planLabel}</span>
                            </div>

                            <div className="mt-4">
                                <div className="flex justify-between text-sm font-medium mb-2">
                                    <span className="text-slate-700 dark:text-slate-300">{t('settings.usage')}</span>
                                    <span className="text-slate-900 dark:text-white">{t('settings.usageOf', { used: usage.totalTests, limit: 3 })}</span>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                                    <div className="bg-primary h-2.5 rounded-full" style={{ width: `${usagePercent}%` }}></div>
                                </div>
                                <p className="text-xs text-slate-500 mt-3">{t('settings.activeNow', { count: usage.activeTests })}</p>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
