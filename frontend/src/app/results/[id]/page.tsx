"use client";

import { useEffect, useMemo, useState } from 'react';
import axios from '@/lib/axios';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TestResultsResponse, TestVariant, VariantStats, VideoDetailsResponse } from '@/lib/api-types';
import { useI18n } from '@/components/LanguageProvider';

type Translator = (key: string, variables?: Record<string, string | number>) => string;

function daysRemaining(startDate: string, durationDays: number): number {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const elapsedDays = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(durationDays - elapsedDays, 0);
}

function formatPercent(value: number, locale: string, decimals: number = 2): string {
    const safe = Number.isFinite(value) ? value : 0;
    return `${safe.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    })}%`;
}

function formatNumber(value: number, locale: string, decimals: number = 0): string {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function formatDateTime(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDate(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    });
}

function toVariantName(variant: TestVariant): string {
    return variant === 'A' ? 'A' : 'B';
}

function getConfidenceLevel(confidence: number, t: Translator): { label: string; className: string } {
    if (confidence >= 0.95) {
        return {
            label: t('results.confidence.high'),
            className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
        };
    }
    if (confidence >= 0.8) {
        return {
            label: t('results.confidence.medium'),
            className: 'bg-amber-500/10 text-amber-500 border-amber-500/20'
        };
    }
    return {
        label: t('results.confidence.low'),
        className: 'bg-rose-500/10 text-rose-500 border-rose-500/20'
    };
}

function getReasonLabel(reason: string, t: Translator): string {
    const reasons = reason
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);

    if (reasons.length === 0) {
        return t('results.noReason');
    }

    return reasons
        .map((token) => {
            const key = `results.reason.${token}`;
            const translated = t(key);
            return translated === key ? token : translated;
        })
        .join(', ');
}

function getHistorySourceLabel(source: string, t: Translator): string {
    const key = `results.history.source.${source}`;
    const translated = t(key);
    return translated === key ? source : translated;
}

function getApiErrorMessage(error: unknown, t: Translator): string {
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
        t('results.errorUnexpected')
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
    isWinner,
    locale,
    t
}: {
    label: string;
    thumbnailUrl: string;
    stats: VariantStats;
    isWinner: boolean;
    locale: string;
    t: Translator;
}) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{label}</span>
                {isWinner && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        {t('results.winner')}
                    </span>
                )}
            </div>
            <div className="aspect-video w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900">
                <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url('${thumbnailUrl}')` }}></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.metric.ctr')}</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatPercent(stats.ctr, locale, 3)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.metric.score')}</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.score, locale, 3)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.metric.impressions')}</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.impressions, locale)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.metric.estimatedClicks')}</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.estimatedClicks, locale)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.metric.watchMinutes')}</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.estimatedMinutesWatched, locale, 2)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.metric.wtpi')}</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{formatNumber(stats.wtpi, locale, 4)}</p>
                </div>
            </div>
        </div>
    );
}

export default function ResultsPage() {
    const params = useParams<{ id: string }>();
    const id = params?.id;
    const { t, locale } = useI18n();

    const [testData, setTestData] = useState<TestResultsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [applyingVariant, setApplyingVariant] = useState<TestVariant | null>(null);
    const [liveState, setLiveState] = useState<VideoDetailsResponse | null>(null);
    const [liveStateLoading, setLiveStateLoading] = useState(false);
    const [liveStateError, setLiveStateError] = useState<string | null>(null);

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
            alert(t('results.errorSync', { message: getApiErrorMessage(error, t) }));
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
            alert(t('results.errorApply', { variant, message: getApiErrorMessage(error, t) }));
        } finally {
            setApplyingVariant(null);
        }
    };

    const handleCheckLiveState = async () => {
        if (!testData || liveStateLoading) {
            return;
        }

        setLiveStateLoading(true);
        setLiveStateError(null);
        try {
            const response = await axios.get<VideoDetailsResponse>(`/api/youtube/video/${testData.test.video_id}`);
            setLiveState(response.data);
        } catch (error) {
            console.error('Live YouTube state check failed', error);
            setLiveState(null);
            setLiveStateError(getApiErrorMessage(error, t));
        } finally {
            setLiveStateLoading(false);
        }
    };

    useEffect(() => {
        if (!id) {
            return;
        }

        setLiveState(null);
        setLiveStateError(null);

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
                <p className="text-slate-500 animate-pulse">{t('results.loading')}</p>
            </div>
        );
    }

    if (!testData) {
        return (
            <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-20 text-center">
                <p className="text-red-500">{t('results.notFound')}</p>
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
    const confidenceLevel = getConfidenceLevel(decision.confidence ?? 0, t);
    const internalState = testData.currentInternalState;
    const historyEvents = testData.variantHistory;
    const dailyVariantResults = testData.dailyVariantResults;
    const sourceLabel = t(`results.stateSource.${internalState.sinceSource}`);
    const resolvedSourceLabel = sourceLabel.startsWith('results.stateSource')
        ? internalState.sinceSource
        : sourceLabel;
    const liveStateMatches = liveState
        ? liveState.title.trim() === internalState.title.trim()
        : null;

    return (
        <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-8 pb-20 overflow-y-auto">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                <div className="flex flex-col gap-2">
                    <Link href="/" className="group flex items-center gap-2 text-slate-400 hover:text-primary transition-colors text-sm font-medium w-fit">
                        <span className="material-symbols-outlined text-lg group-hover:-translate-x-1 transition-transform">arrow_back</span>
                        {t('results.backToDashboard')}
                    </Link>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{activeTest.title_a || t('results.videoFallback')}</h2>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${isFinished ? 'bg-slate-500/10 text-slate-500 border-slate-500/20' : 'bg-green-500/10 text-green-500 border-green-500/20'}`}>
                            {!isFinished && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>}
                            {t('results.status')}: {isFinished ? t('results.finished') : t('results.running')}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceLevel.className}`}>
                            {t('results.confidence')} {confidenceLevel.label} ({formatPercent((decision.confidence ?? 0) * 100, locale, 1)})
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
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('results.collectingData')}</h3>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">{t('results.collectingHint')}</p>
                                    </>
                                )}
                                {isFinished && !isInconclusive && (
                                    <>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                                            {t('results.variantSelected', { variant: computedWinnerVariant ? toVariantName(computedWinnerVariant) : t('results.na') })}
                                        </h3>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                                            {t('results.winnerModeReason', { mode: decision.winnerMode, reason: getReasonLabel(decision.reason, t) })}
                                        </p>
                                    </>
                                )}
                                {isFinished && isInconclusive && (
                                    <>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('results.inconclusive')}</h3>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                                            {t('results.inconclusiveHint')}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.scoreDelta')}</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{formatNumber(scoreDelta, locale, 3)}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.ctrDelta')}</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{formatPercent(ctrDelta, locale, 3)}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.pValue')}</p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">{formatNumber(decision.pValue, locale, 4)}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('results.daysRemaining')}</p>
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
                                {syncing ? t('results.syncing') : t('results.sync')}
                            </button>

                            {isInconclusive && (
                                <>
                                    <button
                                        onClick={() => { void handleApplyWinner('A'); }}
                                        disabled={applyingVariant !== null}
                                        className="w-full sm:w-auto border border-slate-300 dark:border-slate-600 bg-white dark:bg-surface-dark px-4 py-3 rounded-lg text-sm font-semibold text-slate-900 dark:text-white hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                                    >
                                        {applyingVariant === 'A' ? t('results.applyingA') : t('results.applyA')}
                                    </button>
                                    <button
                                        onClick={() => { void handleApplyWinner('B'); }}
                                        disabled={applyingVariant !== null}
                                        className="w-full sm:w-auto border border-primary/40 bg-primary/10 px-4 py-3 rounded-lg text-sm font-semibold text-primary hover:bg-primary hover:text-white transition-colors disabled:opacity-50"
                                    >
                                        {applyingVariant === 'B' ? t('results.applyingB') : t('results.applyB')}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('results.decisionReason')}</h3>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark p-4">
                        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{getReasonLabel(decision.reason, t)}</p>
                    </div>
                </div>
            </div>

            <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <article className={`rounded-xl border bg-white dark:bg-surface-dark p-5 ${getVariantBorderClass('A', computedWinnerVariant)}`}>
                    <VariantCard
                        label={t('new.variantA')}
                        thumbnailUrl={activeTest.thumbnail_url_a}
                        stats={statsA}
                        isWinner={computedWinnerVariant === 'A'}
                        locale={locale}
                        t={t}
                    />
                </article>
                <article className={`rounded-xl border bg-white dark:bg-surface-dark p-5 ${getVariantBorderClass('B', computedWinnerVariant)}`}>
                    <VariantCard
                        label={t('new.variantB')}
                        thumbnailUrl={activeTest.thumbnail_url_b}
                        stats={statsB}
                        isWinner={computedWinnerVariant === 'B'}
                        locale={locale}
                        t={t}
                    />
                </article>
            </section>

            <section className="mt-8">
                <details className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark">
                    <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between">
                        <span className="font-semibold text-slate-900 dark:text-white">{t('results.rotationDiagnostics')}</span>
                        <span className="material-symbols-outlined text-slate-500">expand_more</span>
                    </summary>

                    <div className="border-t border-slate-200 dark:border-slate-700 px-5 py-5 space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <article className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/40 p-4 space-y-3">
                                <h4 className="font-semibold text-slate-900 dark:text-white">{t('results.currentExpectedState')}</h4>
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-600 px-2 py-0.5">
                                        {t('results.currentVariant')}: {internalState.variant}
                                    </span>
                                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-600 px-2 py-0.5">
                                        {t('results.stateSource')}: {resolvedSourceLabel}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-600 dark:text-slate-300">
                                    {t('results.lastChange')}: {formatDateTime(internalState.since, locale)}
                                </p>
                                <p className="text-sm font-medium text-slate-900 dark:text-white break-words">{internalState.title}</p>
                                <div className="aspect-video rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900">
                                    <img
                                        src={internalState.thumbnailUrl}
                                        alt={internalState.title}
                                        className="h-full w-full object-cover"
                                    />
                                </div>
                            </article>

                            <article className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/40 p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <h4 className="font-semibold text-slate-900 dark:text-white">{t('results.youtubeLiveState')}</h4>
                                    <button
                                        type="button"
                                        onClick={() => { void handleCheckLiveState(); }}
                                        disabled={liveStateLoading}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-primary hover:text-primary disabled:opacity-50"
                                    >
                                        <span className={`material-symbols-outlined text-base ${liveStateLoading ? 'animate-spin' : ''}`}>sync</span>
                                        {liveStateLoading ? t('results.checkingLiveState') : t('results.checkLiveState')}
                                    </button>
                                </div>

                                {liveStateError && (
                                    <p className="text-sm text-rose-500">
                                        {t('results.liveStateUnavailable')} {liveStateError}
                                    </p>
                                )}

                                {liveState && (
                                    <>
                                        <p className="text-sm text-slate-600 dark:text-slate-300">
                                            {t('results.liveTitle')}: <span className="font-medium text-slate-900 dark:text-white">{liveState.title}</span>
                                        </p>
                                        <div className="aspect-video rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900">
                                            <img
                                                src={liveState.thumbnailUrl}
                                                alt={liveState.title}
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                        <p className={`text-sm font-medium ${liveStateMatches ? 'text-emerald-500' : 'text-amber-500'}`}>
                                            {t('results.liveComparison')}: {liveStateMatches
                                                ? t('results.liveComparison.match')
                                                : t('results.liveComparison.mismatch')}
                                        </p>
                                    </>
                                )}
                            </article>
                        </div>

                        <article className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/40 p-4">
                            <h4 className="font-semibold text-slate-900 dark:text-white mb-3">{t('results.variantHistory')}</h4>
                            {historyEvents.length === 0 ? (
                                <p className="text-sm text-slate-500">{t('results.history.none')}</p>
                            ) : (
                                <ul className="space-y-2">
                                    {historyEvents.map((eventRow) => (
                                        <li key={eventRow.id} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark px-3 py-2 text-sm">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span className="font-medium text-slate-900 dark:text-white">
                                                    {formatDateTime(eventRow.changedAt, locale)}
                                                </span>
                                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs">
                                                    {t('results.currentVariant')}: {eventRow.variant}
                                                </span>
                                            </div>
                                            <p className="text-slate-600 dark:text-slate-300 mt-1">
                                                {getHistorySourceLabel(eventRow.source, t)}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </article>

                        <article className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/40 p-4">
                            <h4 className="font-semibold text-slate-900 dark:text-white mb-3">{t('results.dailyResultsTimeline')}</h4>
                            {dailyVariantResults.length === 0 ? (
                                <p className="text-sm text-slate-500">{t('results.table.noRows')}</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                                <th className="py-2 pr-3">{t('results.table.date')}</th>
                                                <th className="py-2 pr-3">{t('results.table.variant')}</th>
                                                <th className="py-2 pr-3">{t('results.table.source')}</th>
                                                <th className="py-2 pr-3">{t('results.table.title')}</th>
                                                <th className="py-2 pr-3">{t('results.table.thumbnail')}</th>
                                                <th className="py-2 pr-3">{t('results.table.impressions')}</th>
                                                <th className="py-2 pr-3">{t('results.table.ctr')}</th>
                                                <th className="py-2 pr-3">{t('results.table.estimatedClicks')}</th>
                                                <th className="py-2 pr-3">{t('results.table.views')}</th>
                                                <th className="py-2 pr-3">{t('results.table.watchMinutes')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dailyVariantResults.map((row) => (
                                                <tr key={row.date} className="border-b border-slate-100 dark:border-slate-800 align-top">
                                                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(row.date, locale)}</td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">{row.variant}</td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">
                                                        {row.source === 'exact' ? t('results.stateSource.exact') : t('results.stateSource.inferred')}
                                                    </td>
                                                    <td className="py-2 pr-3 min-w-[220px] text-slate-700 dark:text-slate-200">{row.title}</td>
                                                    <td className="py-2 pr-3">
                                                        <img
                                                            src={row.thumbnailUrl}
                                                            alt={row.title}
                                                            className="h-12 w-20 rounded object-cover border border-slate-200 dark:border-slate-700"
                                                        />
                                                    </td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">{formatNumber(row.impressions, locale)}</td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">{formatPercent(row.ctr, locale, 3)}</td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">{formatNumber(row.clicks, locale)}</td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">{formatNumber(row.views, locale)}</td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">{formatNumber(row.estimated_minutes_watched, locale, 2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </article>
                    </div>
                </details>
            </section>
        </div>
    );
}
