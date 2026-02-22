export type TestStatus = 'active' | 'finished';
export type TestVariant = 'A' | 'B';

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
}

export interface DashboardMetrics {
    activeCount: number;
    avgCtrLift: number;
    extraClicks: number;
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
        plan: string;
        createdAt: string;
    };
    plan: string;
    isYoutubeConnected: boolean;
    channelId: string;
    usage: {
        activeTests: number;
        totalTests: number;
    };
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
}

export interface VariantResults {
    impressions: number;
    clicks: number;
    ctr: number;
}

export interface TestResultsResponse {
    test: TestRecord;
    dailyResults: TestDailyResult[];
    results_a: VariantResults;
    results_b: VariantResults;
}
