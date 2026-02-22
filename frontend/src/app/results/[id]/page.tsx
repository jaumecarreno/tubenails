"use client";

import { useEffect, useMemo, useState } from 'react';
import axios from '@/lib/axios';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TestResultsResponse, TestVariant } from '@/lib/api-types';

function daysRemaining(startDate: string, durationDays: number): number {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const elapsedDays = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(durationDays - elapsedDays, 0);
}

function toVariantName(variant: TestVariant): string {
    return variant === 'A' ? 'A' : 'B';
}

export default function ResultsPage() {
    const params = useParams<{ id: string }>();
    const id = params?.id;

    const [testData, setTestData] = useState<TestResultsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

    const loadResults = async (testId: string) => {
        const response = await axios.get<TestResultsResponse>(`/api/tests/${testId}/results`);
        setTestData(response.data);
    };

    const handleSync = async () => {
        if (!id || syncing) {
            return;
        }
        setSyncing(true);
        try {
            await axios.post(`/api/tests/${id}/sync`);
            await loadResults(id);
        } catch (error) {
            console.error('Sync failed', error);
            alert('Could not synchronize analytics with YouTube.');
        } finally {
            setSyncing(false);
        }
    };

    useEffect(() => {
        if (!id) {
            return;
        }

        const fetchResults = async () => {
            try {
                await loadResults(id);
            } catch (error) {
                console.error('Failed to load test results', error);
            } finally {
                setLoading(false);
            }
        };

        void fetchResults();
    }, [id]);

    const winnerVariant = useMemo<TestVariant>(() => {
        if (!testData) {
            return 'A';
        }
        if (testData.test.status === 'finished') {
            return testData.test.current_variant === 'B' ? 'B' : 'A';
        }
        return testData.results_b.ctr > testData.results_a.ctr ? 'B' : 'A';
    }, [testData]);

    if (loading) {
        return (
            <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-20 text-center">
                <p className="text-slate-500 animate-pulse">Loading results...</p>
            </div>
        );
    }

    if (!testData) {
        return (
            <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-20 text-center">
                <p className="text-red-500">Test not found or API error.</p>
            </div>
        );
    }

    const activeTest = testData.test;
    const isFinished = activeTest.status === 'finished';
    const remainingDays = daysRemaining(activeTest.start_date, activeTest.duration_days);
    const ctrA = testData.results_a.ctr;
    const ctrB = testData.results_b.ctr;
    const impA = testData.results_a.impressions;
    const impB = testData.results_b.impressions;
    const bestCtr = Math.max(ctrA, ctrB);
    const winnerThumbnail = winnerVariant === 'B' ? activeTest.thumbnail_url_b : activeTest.thumbnail_url_a;

    return (
        <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-8 pb-20 overflow-y-auto">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                <div className="flex flex-col gap-2">
                    <Link href="/" className="group flex items-center gap-2 text-slate-400 hover:text-primary transition-colors text-sm font-medium w-fit">
                        <span className="material-symbols-outlined text-lg group-hover:-translate-x-1 transition-transform">arrow_back</span>
                        Back to Dashboard
                    </Link>
                    <div className="flex items-center gap-4 mt-1">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{activeTest.title_a || 'Video Test'}</h2>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${isFinished ? 'bg-slate-500/10 text-slate-500 border-slate-500/20' : 'bg-green-500/10 text-green-500 border-green-500/20'}`}>
                            {!isFinished && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>}
                            Status: {isFinished ? 'Finished' : 'Running'}
                        </span>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl p-6 relative overflow-hidden group shadow-sm">
                        <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/10 blur-[80px] rounded-full pointer-events-none"></div>

                        {!isFinished ? (
                            <div className="flex items-center gap-3 mb-6">
                                <span className="material-symbols-outlined text-3xl text-blue-500">sync</span>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Collecting data...</h3>
                                    <p className="text-slate-500 dark:text-slate-400 text-sm">This test is still running. Rotation executes daily at 00:01 PT.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 mb-6">
                                <span className="material-symbols-outlined text-3xl text-yellow-500">emoji_events</span>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Variant {toVariantName(winnerVariant)} won</h3>
                                    <p className="text-slate-500 dark:text-slate-400 text-sm">The winner is already applied by the daily job.</p>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col md:flex-row gap-6">
                            <div className="relative w-full md:w-1/2 aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-xl">
                                {isFinished && (
                                    <div className="absolute top-3 left-3 z-10 bg-black/80 backdrop-blur-sm text-green-400 text-xs font-bold px-2 py-1 rounded border border-green-500/30 flex items-center gap-1">
                                        <span className="material-symbols-outlined text-sm">trending_up</span>
                                        Winner: {toVariantName(winnerVariant)}
                                    </div>
                                )}
                                <div className="w-full h-full bg-slate-800 bg-cover bg-center" style={{ backgroundImage: `url('${winnerThumbnail}')` }}></div>
                            </div>

                            <div className="flex flex-col justify-center flex-1 gap-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-slate-50 dark:bg-background-dark/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                        <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">Best CTR</p>
                                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{bestCtr}%</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-background-dark/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                        <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">Remaining</p>
                                        <p className="text-2xl font-bold text-blue-500">{remainingDays} days</p>
                                    </div>
                                </div>

                                <div className="h-px bg-slate-200 dark:bg-slate-700 w-full my-2"></div>
                                <button onClick={handleSync} disabled={syncing} className="w-full bg-primary hover:bg-red-600 disabled:bg-slate-300 disabled:dark:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 px-4 rounded-lg shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2">
                                    <span className={`material-symbols-outlined text-[20px] ${syncing ? 'animate-spin' : ''}`}>sync</span>
                                    {syncing ? 'Synchronizing...' : 'Sync Latest Analytics'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Variant Comparison</h3>

                    <div className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex flex-col gap-4 opacity-75 hover:opacity-100 transition-opacity">
                        <div className="flex items-center justify-between">
                            <span className="text-slate-500 dark:text-slate-400 font-medium text-sm">Variant A (Control)</span>
                            <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-1 rounded">Original</span>
                        </div>
                        <div className="aspect-video w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 relative grayscale hover:grayscale-0 transition-all">
                            <div className="w-full h-full bg-cover bg-center" style={{ backgroundImage: `url('${activeTest.thumbnail_url_a}')` }}></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-2">
                            <div>
                                <p className="text-slate-500 text-xs mb-1">CTR</p>
                                <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{ctrA}%</p>
                            </div>
                            <div>
                                <p className="text-slate-500 text-xs mb-1">Impressions</p>
                                <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{impA}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-surface-dark border hover:border-green-500/30 rounded-xl p-5 flex flex-col gap-4 shadow-[0_0_20px_rgba(34,197,94,0.05)] relative overflow-hidden">
                        <div className="flex items-center justify-between relative z-10">
                            <span className="text-slate-900 dark:text-white font-bold text-sm flex items-center gap-2">
                                Variant B (Test)
                                {winnerVariant === 'B' && <span className="material-symbols-outlined text-green-500 text-sm">check_circle</span>}
                            </span>
                        </div>
                        <div className="aspect-video w-full rounded-lg overflow-hidden border border-slate-200 relative">
                            <div className="w-full h-full bg-cover bg-center transform hover:scale-105 transition-transform duration-500" style={{ backgroundImage: `url('${activeTest.thumbnail_url_b}')` }}></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-2 relative z-10">
                            <div>
                                <p className="text-slate-500 text-xs mb-1">CTR</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{ctrB}%</p>
                            </div>
                            <div>
                                <p className="text-slate-500 text-xs mb-1">Impressions</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{impB}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
