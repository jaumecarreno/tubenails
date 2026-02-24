export type TestStatus = 'active' | 'finished';
export type TestVariant = 'A' | 'B';
export type WinnerMode = 'auto' | 'manual' | 'inconclusive' | 'pending';
export type PlanTier = 'basic' | 'premium' | 'teams';
export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface TestRecord {
    id: string;
    user_id: string;
    video_id: string;
    title_a: string;
    title_b: string;
    thumbnail_url_a: string;
    thumbnail_url_b: string;
    start_date: string;
    duration_days: number;
    status: TestStatus;
    current_variant: TestVariant;
    created_at: string;
    winner_variant?: TestVariant | null;
    winner_mode?: WinnerMode | null;
    winner_confidence?: number | null;
    winner_score_a?: number | null;
    winner_score_b?: number | null;
    decision_reason?: string | null;
    review_required?: boolean;
    finished_at?: string | null;
}

export interface DashboardMetrics {
    activeCount: number;
    avgCtrLift: number;
    extraClicks: number;
    avgWtpiLift: number;
    extraWatchMinutes: number;
    inconclusiveCount: number;
}

export interface DashboardResponse {
    activeTests: TestRecord[];
    finishedTests: TestRecord[];
    metrics: DashboardMetrics;
}

export interface UserSettingsResponse {
    user: {
        id: string;
        email: string;
        plan: PlanTier;
        createdAt: string;
    };
    plan: PlanTier;
    isYoutubeConnected: boolean;
    channelId: string;
    usage: {
        activeTests: number;
        totalTests: number;
    };
    workspace: WorkspaceSummary;
}

export interface WorkspaceSummary {
    id: string;
    name: string;
    role: WorkspaceRole;
    ownerUserId: string;
    ownerEmail: string;
    collaborationEnabled: boolean;
    seatLimit: number;
    memberCount: number;
    pendingInvitesCount: number;
    canManageInvites: boolean;
    canManageMembers: boolean;
}

export interface TeamMember {
    user_id: string;
    email: string;
    role: WorkspaceRole;
    created_at: string;
}

export interface PendingInvite {
    id: string;
    email: string;
    role: 'admin' | 'member';
    status: 'pending' | 'accepted' | 'cancelled' | 'expired';
    expires_at: string;
    created_at: string;
}

export interface TeamPermissions {
    canManageInvites: boolean;
    canChangeMemberRole: boolean;
    canRemoveMembers: boolean;
}

export interface TeamResponse {
    workspace: WorkspaceSummary;
    permissions: TeamPermissions;
    members: TeamMember[];
    pendingInvites: PendingInvite[];
}

export interface ChannelVideo {
    videoId: string;
    title: string;
    thumbnailUrl: string;
    publishedAt: string;
}

export interface ChannelVideosResponse {
    channelId: string;
    videos: ChannelVideo[];
}

export interface VideoDetailsResponse {
    title: string;
    thumbnailUrl: string;
}

export interface TestDailyResult {
    date: string;
    impressions: number;
    clicks: number;
    views: number;
    estimated_minutes_watched: number;
    average_view_duration_seconds: number;
    impressions_ctr: number;
}

export interface VariantResults {
    impressions: number;
    clicks: number;
    ctr: number;
}

export interface VariantStats {
    variant: TestVariant;
    exposureDays: number;
    impressions: number;
    estimatedClicks: number;
    ctr: number;
    impressionsCtr: number;
    views: number;
    estimatedMinutesWatched: number;
    averageViewDurationSeconds: number;
    wtpi: number;
    score: number;
    ctrNorm: number;
    wtpiNorm: number;
}

export interface DecisionSummary {
    winnerVariant: TestVariant | null;
    winnerMode: WinnerMode;
    confidence: number;
    pValue: number;
    reviewRequired: boolean;
    reason: string;
}

export interface CurrentInternalState {
    variant: TestVariant;
    title: string;
    thumbnailUrl: string;
    since: string;
    sinceSource: 'exact' | 'inferred';
}

export interface VariantHistoryEvent {
    id: string;
    changedAt: string;
    variant: TestVariant;
    source: 'test_created' | 'daily_rotation' | 'auto_winner' | 'manual_winner' | 'inconclusive_revert';
    changedByUserId: string | null;
}

export interface DailyVariantResult {
    date: string;
    variant: TestVariant;
    source: 'exact' | 'inferred';
    title: string;
    thumbnailUrl: string;
    impressions: number;
    clicks: number;
    views: number;
    estimated_minutes_watched: number;
    average_view_duration_seconds: number;
    impressions_ctr: number;
    ctr: number;
}

export interface TestResultsResponse {
    test: TestRecord;
    dailyResults: TestDailyResult[];
    results_a: VariantResults;
    results_b: VariantResults;
    variant_stats: {
        a: VariantStats;
        b: VariantStats;
    };
    currentInternalState: CurrentInternalState;
    variantHistory: VariantHistoryEvent[];
    dailyVariantResults: DailyVariantResult[];
    decision: DecisionSummary;
}
