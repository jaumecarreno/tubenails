"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import axios from '@/lib/axios';
import {
    PendingInvite,
    TeamMember,
    TeamResponse,
    UserSettingsResponse,
    WorkspaceRole
} from '@/lib/api-types';
import { useI18n } from '@/components/LanguageProvider';

type InviteRole = 'admin' | 'member';

interface CreateInviteResponse {
    inviteId: string;
    inviteUrl: string;
    expiresAt: string;
}

function getErrorMessage(error: unknown): string {
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
        'Unexpected error'
    );
}

function getRoleLabel(t: (key: string) => string, role: WorkspaceRole): string {
    if (role === 'owner') {
        return t('team.role.owner');
    }
    if (role === 'admin') {
        return t('team.role.admin');
    }
    return t('team.role.member');
}

export default function SettingsPage() {
    const [userData, setUserData] = useState<UserSettingsResponse | null>(null);
    const [teamData, setTeamData] = useState<TeamResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [teamLoading, setTeamLoading] = useState(true);

    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<InviteRole>('member');
    const [submittingInvite, setSubmittingInvite] = useState(false);
    const [processingInviteToken, setProcessingInviteToken] = useState(false);
    const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
    const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
    const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null);

    const { t } = useI18n();
    const searchParams = useSearchParams();
    const inviteToken = searchParams.get('inviteToken');

    async function fetchSettings() {
        const response = await axios.get<UserSettingsResponse>(`/api/user/settings?t=${Date.now()}`);
        setUserData(response.data);
    }

    async function fetchTeam() {
        const response = await axios.get<TeamResponse>(`/api/team?t=${Date.now()}`);
        setTeamData(response.data);
    }

    useEffect(() => {
        const load = async () => {
            try {
                await Promise.all([fetchSettings(), fetchTeam()]);
            } catch (error) {
                console.error('Failed fetching settings/team data', error);
            } finally {
                setLoading(false);
                setTeamLoading(false);
            }
        };
        void load();
    }, []);

    useEffect(() => {
        if (!inviteToken) {
            return;
        }

        const acceptInvite = async () => {
            setProcessingInviteToken(true);
            try {
                await axios.post('/api/team/invites/accept', { token: inviteToken });
                await Promise.all([fetchSettings(), fetchTeam()]);
                alert(t('team.inviteAccepted'));
            } catch (error) {
                console.error('Failed accepting invite token', error);
                alert(`${t('team.inviteAcceptFailed')}: ${getErrorMessage(error)}`);
            } finally {
                setProcessingInviteToken(false);
            }
        };

        void acceptInvite();
    }, [inviteToken, t]);

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

    const handleCreateInvite = async () => {
        if (!inviteEmail.trim()) {
            return;
        }

        try {
            setSubmittingInvite(true);
            const response = await axios.post<CreateInviteResponse>('/api/team/invites', {
                email: inviteEmail.trim(),
                role: inviteRole
            });
            const inviteUrl = response.data.inviteUrl;

            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(inviteUrl);
                alert(t('team.copySuccess'));
            } else {
                alert(`${t('team.copyFallback')}\n${inviteUrl}`);
            }

            setInviteEmail('');
            setInviteRole('member');
            await Promise.all([fetchTeam(), fetchSettings()]);
        } catch (error) {
            console.error('Failed to create invite', error);
            alert(`${t('team.errorInviteCreate')}: ${getErrorMessage(error)}`);
        } finally {
            setSubmittingInvite(false);
        }
    };

    const handleCancelInvite = async (inviteId: string) => {
        try {
            setCancellingInviteId(inviteId);
            await axios.delete(`/api/team/invites/${inviteId}`);
            await Promise.all([fetchTeam(), fetchSettings()]);
        } catch (error) {
            console.error('Failed to cancel invite', error);
            alert(`${t('team.errorInviteCancel')}: ${getErrorMessage(error)}`);
        } finally {
            setCancellingInviteId(null);
        }
    };

    const handleRoleChange = async (memberUserId: string, role: InviteRole) => {
        try {
            setUpdatingMemberId(memberUserId);
            await axios.patch(`/api/team/members/${memberUserId}`, { role });
            await fetchTeam();
        } catch (error) {
            console.error('Failed to update team member role', error);
            alert(`${t('team.errorMemberRole')}: ${getErrorMessage(error)}`);
        } finally {
            setUpdatingMemberId(null);
        }
    };

    const handleRemoveMember = async (memberUserId: string) => {
        try {
            setRemovingMemberId(memberUserId);
            await axios.delete(`/api/team/members/${memberUserId}`);
            await Promise.all([fetchTeam(), fetchSettings()]);
        } catch (error) {
            console.error('Failed to remove team member', error);
            alert(`${t('team.errorMemberRemove')}: ${getErrorMessage(error)}`);
        } finally {
            setRemovingMemberId(null);
        }
    };

    if (loading || teamLoading) {
        return (
            <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-20 text-center">
                <p className="text-slate-500 animate-pulse">{t('settings.loading')}</p>
            </div>
        );
    }

    const safeUserData: UserSettingsResponse = userData ?? {
        user: { id: '', email: '', plan: 'basic', createdAt: '' },
        plan: 'basic',
        isYoutubeConnected: false,
        channelId: '',
        usage: { activeTests: 0, totalTests: 0 },
        workspace: {
            id: '',
            name: '',
            role: 'owner',
            ownerUserId: '',
            ownerEmail: '',
            collaborationEnabled: false,
            seatLimit: 1,
            memberCount: 1,
            pendingInvitesCount: 0,
            canManageInvites: false,
            canManageMembers: false
        }
    };

    const safeTeamData: TeamResponse = teamData ?? {
        workspace: safeUserData.workspace,
        permissions: {
            canManageInvites: false,
            canChangeMemberRole: false,
            canRemoveMembers: false
        },
        members: [],
        pendingInvites: []
    };

    const { user, isYoutubeConnected, usage, channelId, plan, workspace } = safeUserData;
    const { permissions, members, pendingInvites } = safeTeamData;
    const isWorkspaceOwner = workspace.role === 'owner' && workspace.ownerUserId === user.id;
    const usagePercent = Math.min((usage.totalTests / 3) * 100, 100);
    const seatsPercent = Math.min((workspace.memberCount / Math.max(workspace.seatLimit, 1)) * 100, 100);

    let planLabel = t('settings.plan.basic');
    if (plan === 'teams') {
        planLabel = t('settings.plan.teams');
    } else if (plan === 'premium') {
        planLabel = t('settings.plan.premium');
    }

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

            {processingInviteToken && (
                <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    {t('team.processingInvite')}
                </div>
            )}

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
                                        <h3 className="text-base font-bold text-slate-900 dark:text-white">{workspace.ownerEmail || t('settings.userFallback')}</h3>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('settings.authorized')}</p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap justify-between items-center gap-3 w-full">
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
                                    {isWorkspaceOwner && (
                                        <button
                                            onClick={handleDisconnectYoutube}
                                            className="inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-transparent px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 shadow-sm hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800 transition-colors"
                                        >
                                            <span className="material-symbols-outlined mr-2 text-[18px]">link_off</span>
                                            {t('settings.disconnectChannel')}
                                        </button>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-6">
                                <p className="text-slate-500 mb-4 text-sm">{t('settings.connectHint')}</p>
                                {isWorkspaceOwner ? (
                                    <button onClick={handleConnectYoutube} className="inline-flex items-center justify-center rounded-lg bg-red-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-red-700 transition-colors">
                                        <span className="material-symbols-outlined mr-2">video_library</span>
                                        {t('settings.connectYoutube')}
                                    </button>
                                ) : (
                                    <p className="text-xs text-slate-500">{t('team.onlyOwnerCanConnectYoutube')}</p>
                                )}
                            </div>
                        )}
                    </section>

                    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark p-6 shadow-sm space-y-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-emerald-500">groups</span>
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('team.title')}</h2>
                            </div>
                            <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                                {getRoleLabel(t, workspace.role)}
                            </span>
                        </div>

                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/40">
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                {t('team.workspaceLabel')}: <span className="font-semibold">{workspace.name}</span>
                            </p>
                            <div className="mt-3">
                                <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
                                    <span>{t('team.seats')}</span>
                                    <span>{workspace.memberCount}/{workspace.seatLimit}</span>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${seatsPercent}%` }}></div>
                                </div>
                            </div>
                        </div>

                        {!workspace.collaborationEnabled ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
                                {t('team.collaborationDisabled')}
                            </div>
                        ) : (
                            <>
                                {permissions.canManageInvites && (
                                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('team.invite')}</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                            <input
                                                type="email"
                                                value={inviteEmail}
                                                onChange={(event) => setInviteEmail(event.target.value)}
                                                placeholder={t('team.inviteEmailPlaceholder')}
                                                className="md:col-span-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                                            />
                                            <select
                                                value={inviteRole}
                                                onChange={(event) => setInviteRole(event.target.value as InviteRole)}
                                                className="md:col-span-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                                            >
                                                <option value="member">{t('team.role.member')}</option>
                                                <option value="admin">{t('team.role.admin')}</option>
                                            </select>
                                            <button
                                                onClick={handleCreateInvite}
                                                disabled={submittingInvite || inviteEmail.trim().length === 0}
                                                className="md:col-span-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                                            >
                                                {submittingInvite ? '...' : t('team.sendInvite')}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('team.members')}</h3>
                                    {members.length === 0 ? (
                                        <p className="text-sm text-slate-500">{t('team.noMembers')}</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {members.map((member: TeamMember) => {
                                                const canEditRole = permissions.canChangeMemberRole && member.role !== 'owner' && member.user_id !== user.id;
                                                const canRemove = permissions.canRemoveMembers && member.role !== 'owner' && member.user_id !== user.id;
                                                return (
                                                    <div key={member.user_id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2">
                                                        <div>
                                                            <p className="text-sm font-medium text-slate-900 dark:text-white">{member.email}</p>
                                                            <p className="text-xs text-slate-500">{t('team.memberSince')}: {new Date(member.created_at).toLocaleDateString()}</p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {canEditRole ? (
                                                                <select
                                                                    value={member.role}
                                                                    disabled={updatingMemberId === member.user_id}
                                                                    onChange={(event) => { void handleRoleChange(member.user_id, event.target.value as InviteRole); }}
                                                                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                                                                >
                                                                    <option value="member">{t('team.role.member')}</option>
                                                                    <option value="admin">{t('team.role.admin')}</option>
                                                                </select>
                                                            ) : (
                                                                <span className="text-xs text-slate-600 dark:text-slate-300">{getRoleLabel(t, member.role)}</span>
                                                            )}
                                                            {canRemove && (
                                                                <button
                                                                    onClick={() => { void handleRemoveMember(member.user_id); }}
                                                                    disabled={removingMemberId === member.user_id}
                                                                    className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-60"
                                                                >
                                                                    {t('team.removeMember')}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('team.pendingInvites')}</h3>
                                    {pendingInvites.length === 0 ? (
                                        <p className="text-sm text-slate-500">{t('team.noPendingInvites')}</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {pendingInvites.map((invite: PendingInvite) => (
                                                <div key={invite.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2">
                                                    <div>
                                                        <p className="text-sm font-medium text-slate-900 dark:text-white">{invite.email}</p>
                                                        <p className="text-xs text-slate-500">
                                                            {t('team.expiresAt')}: {new Date(invite.expires_at).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                    {permissions.canManageInvites && (
                                                        <button
                                                            onClick={() => { void handleCancelInvite(invite.id); }}
                                                            disabled={cancellingInviteId === invite.id}
                                                            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                                                        >
                                                            {t('team.cancelInvite')}
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
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
