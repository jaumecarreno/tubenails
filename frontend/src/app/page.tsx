"use client";

import { useEffect, useState } from 'react';
import axios from '@/lib/axios';
import Link from 'next/link';
import Image from 'next/image';
import { DashboardResponse, TestRecord } from '@/lib/api-types';

function ThumbnailImage({ src, alt }: { src: string; alt: string }) {
    const resolvedSrc = src || '/placeholder.jpg';
    if (resolvedSrc.startsWith('data:')) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={resolvedSrc} alt={alt} className="h-full w-full object-cover opacity-80 group-hover/thumb:opacity-100 transition-opacity" />;
    }

    return (
        <Image
            src={resolvedSrc}
            alt={alt}
            fill
            sizes="(max-width: 1280px) 50vw, 25vw"
            className="object-cover opacity-80 group-hover/thumb:opacity-100 transition-opacity"
        />
    );
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await axios.get<DashboardResponse>('/api/dashboard');
                setData(response.data);
            } catch (error) {
                console.error('Failed fetching dashboard data', error);
            } finally {
                setLoading(false);
            }
        };
        void fetchData();
    }, []);

    const safeData: DashboardResponse = data ?? {
        activeTests: [],
        finishedTests: [],
        metrics: {
            activeCount: 0,
            avgCtrLift: 0,
            extraClicks: 0,
            avgWtpiLift: 0,
            extraWatchMinutes: 0,
            inconclusiveCount: 0
        }
    };

    return (
        <>
            <header className="h-16 flex items-center justify-between px-6 lg:px-10 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-background-dark/50 backdrop-blur-md sticky top-0 z-40">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Dashboard</h2>
                <div className="flex items-center gap-4">
                    <Link href="/new" className="hidden sm:flex items-center gap-2 py-2 px-4 bg-primary hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors shadow-lg shadow-primary/25">
                        <span className="material-symbols-outlined text-[20px]">add</span>
                        Create New Test
                    </Link>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-8">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <p className="text-slate-500 animate-pulse">Loading API data...</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6">
                            <div className="p-5 rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Active Tests</span>
                                    <span className="material-symbols-outlined text-slate-400 dark:text-slate-500">science</span>
                                </div>
                                <div className="flex items-end gap-2 mt-2">
                                    <span className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{safeData.metrics.activeCount}</span>
                                </div>
                            </div>

                            <div className="p-5 rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Average CTR Lift</span>
                                    <span className="material-symbols-outlined text-success">trending_up</span>
                                </div>
                                <div className="flex items-end gap-2 mt-2">
                                    <span className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                                        {safeData.metrics.avgCtrLift >= 0 ? '+' : ''}
                                        {safeData.metrics.avgCtrLift}%
                                    </span>
                                </div>
                            </div>

                            <div className="p-5 rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Watch-Time Lift</span>
                                    <span className="material-symbols-outlined text-blue-500">timer</span>
                                </div>
                                <div className="flex items-end gap-2 mt-2">
                                    <span className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                                        {safeData.metrics.avgWtpiLift >= 0 ? '+' : ''}
                                        {safeData.metrics.avgWtpiLift}%
                                    </span>
                                </div>
                            </div>

                            <div className="p-5 rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Extra Clicks</span>
                                    <span className="material-symbols-outlined text-primary">ads_click</span>
                                </div>
                                <div className="flex items-end gap-2 mt-2">
                                    <span className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{safeData.metrics.extraClicks}</span>
                                </div>
                            </div>

                            <div className="p-5 rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Extra Watch Minutes</span>
                                    <span className="material-symbols-outlined text-indigo-500">schedule</span>
                                </div>
                                <div className="flex items-end gap-2 mt-2">
                                    <span className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{safeData.metrics.extraWatchMinutes}</span>
                                </div>
                            </div>

                            <div className="p-5 rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Inconclusive Tests</span>
                                    <span className="material-symbols-outlined text-amber-500">warning</span>
                                </div>
                                <div className="flex items-end gap-2 mt-2">
                                    <span className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{safeData.metrics.inconclusiveCount}</span>
                                </div>
                            </div>
                        </div>

                        <section className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-success"></span>
                                    </span>
                                    Active A/B Tests
                                </h3>
                            </div>

                            {safeData.activeTests.length === 0 ? (
                                <div className="p-6 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                                    <p className="text-slate-500">No active tests right now.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                    {safeData.activeTests.map((test: TestRecord) => (
                                        <article key={test.id} className="flex flex-col rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-colors group">
                                            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-start gap-4">
                                                <div>
                                                    <h4 className="font-bold text-base text-slate-900 dark:text-white line-clamp-1 group-hover:text-primary transition-colors">{test.title_a}</h4>
                                                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                                                        <span className="text-success font-medium">Running</span>
                                                        <span>•</span>
                                                        <span>Started: {new Date(test.start_date).toLocaleDateString()}</span>
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/50">
                                                <div className="p-5 flex flex-col gap-3">
                                                    <div className="relative aspect-video bg-slate-800 rounded-lg overflow-hidden border border-slate-700 group/thumb">
                                                        <ThumbnailImage src={test.thumbnail_url_a} alt="Variant A" />
                                                        <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm text-[10px] font-bold text-white rounded">Control (A)</span>
                                                    </div>
                                                </div>

                                                <div className="p-5 flex flex-col gap-3">
                                                    <div className="relative aspect-video bg-slate-800 rounded-lg overflow-hidden border border-slate-700 group/thumb">
                                                        <ThumbnailImage src={test.thumbnail_url_b} alt="Variant B" />
                                                        <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm text-[10px] font-bold text-white rounded">Variant (B)</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50 flex justify-end">
                                                <Link href={`/results/${test.id}`} className="text-xs font-semibold text-primary hover:text-red-600">View Detailed Analytics →</Link>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </>
    );
}
