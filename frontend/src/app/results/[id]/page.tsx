"use client";

import { useEffect, useMemo, useState } from 'react';
import axios from '@/lib/axios';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TestResultsResponse, TestVariant, VariantStats } from '@/lib/api-types';

function daysRemaining(startDate: string, durationDays: number): number {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const elapsedDays = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(durationDays - elapsedDays, 0);
}

function formatPercent(value: number, decimals: number = 2): string {
    const safe = Number.isFinite(value) ? value : 0;
    return `${safe.toFixed(decimals)}%`;
}

function formatNumber(value: number, decimals: number = 0): string {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function toVariantName(variant: TestVariant): string {
    return variant === 'A' ? 'A' : 'B';
}

function getConfidenceLevel(confidence: number): { label: string; className: string } {
    if (confidence >= 0.95) {
        return {
            label: 'High',
            className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
        };
    }
    if (confidence >= 0.8) {
        return {
            label: 'Medium',
            className: 'bg-amber-500/10 text-amber-500 border-amber-500/20'
        };
    }
    return {
        label: 'Low',
        className: 'bg-rose-500/10 text-rose-500 border-rose-500/20'
    };
}

function getReasonLabel(reason: string): string {
    const reasons = reason
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);

    if (reasons.length === 0) {
        return 'No reason provided';
    }

    const labels: Record<string, string> = {
        auto_criteria_met: 'Auto criteria met',
        manual_override: 'Manual winner applied',
        test_in_progress: 'Test still running',
        criteria_met_waiting_test_end: 'Criteria met but waiting for test end',
        insufficient_exposure_days: 'Not enough exposure days',
        insufficient_impressions: 'Not enough impressions',
        insufficient_confidence: 'Confidence below threshold',
        insufficient_ctr_delta: 'CTR delta below threshold',
        insufficient_score_delta: 'Score delta below threshold'
    };

    return reasons.map((token) => labels[token] ?? token).join(', ');
}

function getApiErrorMessage(error: unknown): string {
    const maybeError = error as {
        response?: {
            data?: {
                error?: string;
                details?: string;
            };
        };
        message?: string;
    };

    return (
        maybeError.response?.data?.details ??
        maybeError.response?.data?.error ??
        maybeError.message ??
        'Unexpected API error'
    );
}

function getVariantBorderClass(variant: TestVariant, winnerVariant: TestVariant | null): string {
    if (!winnerVariant) {
        return 'border-slate-200 dark:border-slate-700';
    }
    if (winnerVariant === variant) {
        return 'border-emerald-500/40 shadow-[0_0_24px_rgba(16,185,129,0.08)]';
    }
    return 'border-slate-200 dark:border-slate-700 opacity-80';
}

function VariantCard({
    label,
    thumbnailUrl,
    stats,
    isWinner
}: {
    label: string;
    thumbnailUrl: string;
    stats: VariantStats;
    isWinner: boolean;
}) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{label}</span>
                {isWinner && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        Winner
                    </span>
                )}
            </div>
            <div className="aspect-video w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900">
                <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url('${thumbnailUrl}')` }}></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">CTR</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatPercent(stats.ctr, 3)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Score</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.score, 3)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Impressions</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.impressions)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Estimated Clicks</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.estimatedClicks)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Watch Minutes</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.estimatedMinutesWatched, 2)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">WTPI</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.wtpi, 4)}</p>
                </div>
            </div>
        </div>
    );
}

export default function ResultsPage() {
    const params = useParams<{ id: string }>();
    const id = params?.id;

    const [testData, setTestData] = useState<TestResultsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [applyingVariant, setApplyingVariant] = useState<TestVariant | null>(null);

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
            alert(`Could not synchronize analytics: ${getApiErrorMessage(error)}`);
        } finally {
            setSyncing(false);
        }
    };

    const handleApplyWinner = async (variant: TestVariant) => {
        if (!id || applyingVariant) {
            return;
        }

        setApplyingVariant(variant);
        try {
            await axios.post(`/api/tests/${id}/apply-winner`, { variant });
            await loadResults(id);
        } catch (error) {
            console.error('Manual winner apply failed', error);
            alert(`Could not apply variant ${variant}: ${getApiErrorMessage(error)}`);
        } finally {
            setApplyingVariant(null);
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

    const computedWinnerVariant = useMemo<TestVariant | null>(() => {
        if (!testData) {
            return null;
        }

        if (testData.decision.winnerMode === 'inconclusive') {
            return null;
        }

        if (testData.decision.winnerVariant) {
            return testData.decision.winnerVariant;
        }

        if (testData.test.status === 'finished') {
            return testData.test.current_variant === 'B' ? 'B' : 'A';
        }

        return testData.variant_stats.b.score > testData.variant_stats.a.score ? 'B' : 'A';
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
    const statsA = testData.variant_stats.a;
    const statsB = testData.variant_stats.b;
    const decision = testData.decision;
    const isFinished = activeTest.status === 'finished';
    const isInconclusive = isFinished && decision.winnerMode === 'inconclusive';
    const remainingDays = daysRemaining(activeTest.start_date, activeTest.duration_days);
    const scoreDelta = Math.abs(statsA.score - statsB.score);
    const ctrDelta = Math.abs(statsA.ctr - statsB.ctr);
    const confidenceLevel = getConfidenceLevel(decision.confidence ?? 0);

    return (
        <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-8 pb-20 overflow-y-auto">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                <div className="flex flex-col gap-2">
                    <Link href="/" className="group flex items-center gap-2 text-slate-400 hover:text-primary transition-colors text-sm font-medium w-fit">
                        <span className="material-symbols-outlined text-lg group-hover:-translate-x-1 transition-transform">arrow_back</span>
                        Back to Dashboard
                    </Link>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{activeTest.title_a || 'Video Test'}</h2>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${isFinished ? 'bg-slate-500/10 text-slate-500 border-slate-500/20' : 'bg-green-500/10 text-green-500 border-green-500/20'}`}>
                            {!isFinished && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>}
                            Status: {isFinished ? 'Finished' : 'Running'}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceLevel.className}`}>
                            Confidence {confidenceLevel.label} ({formatPercent((decision.confidence ?? 0) * 100, 1)})
                        </span>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl p-6 relative overflow-hidden group shadow-sm">
                        <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/10 blur-[80px] rounded-full pointer-events-none"></div>

                        <div className="flex items-center gap-3 mb-6">
                            <span className={`material-symbols-outlined text-3xl ${isInconclusive ? 'text-amber-500' : isFinished ? 'text-emerald-500' : 'text-blue-500'}`}>
                                {isInconclusive ? 'warning' : isFinished ? 'emoji_events' : 'sync'}
                            </span>
                            <div>
                                {!isFinished && (
                                    <>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">Collecting data</h3>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">Rotation executes daily at 00:01 PT. Winner decision remains pending.</p>
                                    </>
                                )}
                                {isFinished && !isInconclusive && (
                                    <>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                                            Variant {computedWinnerVariant ? toVariantName(computedWinnerVariant) : 'N/A'} selected
                                        </h3>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                                            Winner mode: {decision.winnerMode}. Reason: {getReasonLabel(decision.reason)}.
                                        </p>
                                    </>
                                )}
                                {isFinished && isInconclusive && (
                                    <>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">Inconclusive test</h3>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                                            Auto-win criteria not met. Choose a variant manually to close with override.
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">Score Delta</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{formatNumber(scoreDelta, 3)}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">CTR Delta</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{formatPercent(ctrDelta, 3)}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">P-Value</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{formatNumber(decision.pValue, 4)}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">Days Remaining</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{remainingDays}</p>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                onClick={handleSync}
                                disabled={syncing || applyingVariant !== null}
                                className="w-full sm:w-auto bg-primary hover:bg-red-600 disabled:bg-slate-300 disabled:dark:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 px-4 rounded-lg shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2"
                            >
                                <span className={`material-symbols-outlined text-[20px] ${syncing ? 'animate-spin' : ''}`}>sync</span>
                                {syncing ? 'Synchronizing...' : 'Sync Latest Analytics'}
                            </button>

                            {isInconclusive && (
                                <>
                                    <button
                                        onClick={() => { void handleApplyWinner('A'); }}
                                        disabled={applyingVariant !== null}
                                        className="w-full sm:w-auto border border-slate-300 dark:border-slate-600 bg-white dark:bg-surface-dark px-4 py-3 rounded-lg text-sm font-semibold text-slate-900 dark:text-white hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                                    >
                                        {applyingVariant === 'A' ? 'Applying A...' : 'Apply Manual A'}
                                    </button>
                                    <button
                                        onClick={() => { void handleApplyWinner('B'); }}
                                        disabled={applyingVariant !== null}
                                        className="w-full sm:w-auto border border-primary/40 bg-primary/10 px-4 py-3 rounded-lg text-sm font-semibold text-primary hover:bg-primary hover:text-white transition-colors disabled:opacity-50"
                                    >
                                        {applyingVariant === 'B' ? 'Applying B...' : 'Apply Manual B'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Decision Reason</h3>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark p-4">
                        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{getReasonLabel(decision.reason)}</p>
                    </div>
                </div>
            </div>

            <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <article className={`rounded-xl border bg-white dark:bg-surface-dark p-5 ${getVariantBorderClass('A', computedWinnerVariant)}`}>
                    <VariantCard
                        label="Variant A (Control)"
                        thumbnailUrl={activeTest.thumbnail_url_a}
                        stats={statsA}
                        isWinner={computedWinnerVariant === 'A'}
                    />
                </article>
                <article className={`rounded-xl border bg-white dark:bg-surface-dark p-5 ${getVariantBorderClass('B', computedWinnerVariant)}`}>
                    <VariantCard
                        label="Variant B (Test)"
                        thumbnailUrl={activeTest.thumbnail_url_b}
                        stats={statsB}
                        isWinner={computedWinnerVariant === 'B'}
                    />
                </article>
            </section>
        </div>
    );
}
