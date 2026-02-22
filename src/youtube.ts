import { google } from 'googleapis';
import { getClientForUser } from './auth';
import * as fs from 'fs';
import * as path from 'path';

const DATA_IMAGE_URL_REGEX = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i;

interface ParsedDataImage {
    mimeType: string;
    payload: string;
}

export interface DailyAnalyticsPoint {
    impressions: number;
    impressionsCtr: number;
    views: number;
    estimatedMinutesWatched: number;
    averageViewDurationSeconds: number;
    qualityAvailable: boolean;
    metricVersion: number;
    usedMetrics: string;
}

function extensionFromMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('png')) {
        return 'png';
    }
    if (normalized.includes('webp')) {
        return 'webp';
    }
    return 'jpg';
}

function parseDataImageUrl(source: string): ParsedDataImage | null {
    const match = source.match(DATA_IMAGE_URL_REGEX);
    if (!match) {
        return null;
    }
    return {
        mimeType: match[1],
        payload: match[2]
    };
}

function toSafeNumber(value: unknown): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
}

async function writeThumbnailSourceToTemp(source: string, filepath: string): Promise<void> {
    const dataImage = parseDataImageUrl(source);
    if (dataImage) {
        const buffer = Buffer.from(dataImage.payload, 'base64');
        if (buffer.length === 0) {
            throw new Error('Uploaded thumbnail is empty');
        }
        await fs.promises.writeFile(filepath, buffer);
        return;
    }

    let url: URL;
    try {
        url = new URL(source);
    } catch {
        throw new Error('Invalid thumbnail source');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Thumbnail source must use HTTP/HTTPS');
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`Failed downloading thumbnail (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
        throw new Error('Downloaded thumbnail is empty');
    }

    await fs.promises.writeFile(filepath, buffer);
}

function parseAnalyticsRow(
    row: Array<string | number>,
    metrics: string[]
): DailyAnalyticsPoint {
    const offset = 2; // dimensions day,video
    const metricValueByName = new Map<string, number>();
    metrics.forEach((metric, index) => {
        metricValueByName.set(metric, toSafeNumber(row[offset + index]));
    });

    const impressions = metricValueByName.get('impressions') ?? 0;
    const impressionsCtr = metricValueByName.get('impressionsCtr') ?? 0;
    const views = metricValueByName.get('views') ?? 0;
    const estimatedMinutesWatched = metricValueByName.get('estimatedMinutesWatched') ?? 0;
    const averageViewDurationSecondsFromApi = metricValueByName.get('averageViewDuration') ?? 0;
    const averageViewDurationSeconds = averageViewDurationSecondsFromApi > 0
        ? averageViewDurationSecondsFromApi
        : (views > 0 ? (estimatedMinutesWatched * 60) / views : 0);

    return {
        impressions,
        impressionsCtr,
        views,
        estimatedMinutesWatched,
        averageViewDurationSeconds,
        qualityAvailable: metrics.includes('estimatedMinutesWatched'),
        metricVersion: 2,
        usedMetrics: metrics.join(',')
    };
}

export async function getChannelVideos(userId: string, maxResults: number = 10) {
    const auth = await getClientForUser(userId);
    const youtube = google.youtube({ version: 'v3', auth });

    const channelRes = await youtube.channels.list({
        part: ['contentDetails'],
        mine: true
    });

    if (!channelRes.data.items || channelRes.data.items.length === 0) {
        return { channelId: '', videos: [] };
    }

    const uploadsPlaylistId = channelRes.data.items[0].contentDetails?.relatedPlaylists?.uploads;
    const channelId = channelRes.data.items[0].id || '';
    if (!uploadsPlaylistId) {
        return { channelId, videos: [] };
    }

    const playlistRes = await youtube.playlistItems.list({
        part: ['snippet'],
        playlistId: uploadsPlaylistId,
        maxResults
    });

    if (!playlistRes.data.items) {
        return { channelId, videos: [] };
    }

    const videos = playlistRes.data.items.map((item) => ({
        videoId: item.snippet?.resourceId?.videoId || '',
        title: item.snippet?.title || '',
        thumbnailUrl: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
        publishedAt: item.snippet?.publishedAt || ''
    }));

    return { channelId, videos };
}

export async function getVideoDetails(userId: string, videoId: string) {
    const auth = await getClientForUser(userId);
    const youtube = google.youtube({ version: 'v3', auth });

    const res = await youtube.videos.list({
        part: ['snippet'],
        id: [videoId]
    });

    if (!res.data.items || res.data.items.length === 0) {
        throw new Error('Video not found');
    }

    const snippet = res.data.items[0].snippet;
    return {
        title: snippet?.title || '',
        thumbnailUrl: snippet?.thumbnails?.maxres?.url || snippet?.thumbnails?.high?.url || snippet?.thumbnails?.medium?.url || snippet?.thumbnails?.default?.url || ''
    };
}

export async function updateVideoThumbnail(userId: string, videoId: string, thumbnailSource: string) {
    const auth = await getClientForUser(userId);
    const youtube = google.youtube({ version: 'v3', auth });

    const parsedDataImage = parseDataImageUrl(thumbnailSource);
    const extension = parsedDataImage ? extensionFromMimeType(parsedDataImage.mimeType) : 'jpg';
    const tempFilePath = path.join(__dirname, `../temp_thumb_${videoId}_${Date.now()}.${extension}`);

    try {
        await writeThumbnailSourceToTemp(thumbnailSource, tempFilePath);

        const res = await youtube.thumbnails.set({
            videoId,
            media: {
                body: fs.createReadStream(tempFilePath)
            }
        });
        console.log(`Thumbnail updated for video ${videoId}`);
        return res.data;
    } finally {
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    }
}

export async function updateVideoTitle(userId: string, videoId: string, newTitle: string) {
    const auth = await getClientForUser(userId);
    const youtube = google.youtube({ version: 'v3', auth });

    const videoParams = await youtube.videos.list({
        part: ['snippet'],
        id: [videoId]
    });

    if (!videoParams.data.items || videoParams.data.items.length === 0) {
        throw new Error('Video not found');
    }

    const snippet = videoParams.data.items[0].snippet;
    if (!snippet) {
        throw new Error('Snippet is missing');
    }

    snippet.title = newTitle;
    if (!snippet.categoryId) {
        snippet.categoryId = '22';
    }

    const res = await youtube.videos.update({
        part: ['snippet'],
        requestBody: {
            id: videoId,
            snippet
        }
    });

    console.log(`Title updated for video ${videoId} to "${newTitle}"`);
    return res.data;
}

export async function getDailyAnalytics(userId: string, videoId: string, dateStr: string): Promise<DailyAnalyticsPoint | null> {
    const auth = await getClientForUser(userId);
    const analytics = google.youtubeAnalytics({ version: 'v2', auth });

    const metricAttempts: string[][] = [
        ['impressions', 'impressionsCtr', 'views', 'estimatedMinutesWatched', 'averageViewDuration'],
        ['impressions', 'impressionsCtr', 'views', 'estimatedMinutesWatched'],
        ['impressions', 'impressionsCtr', 'views']
    ];

    let lastError: unknown = null;
    for (const metrics of metricAttempts) {
        try {
            const res = await analytics.reports.query({
                ids: 'channel==MINE',
                startDate: dateStr,
                endDate: dateStr,
                metrics: metrics.join(','),
                dimensions: 'day,video',
                filters: `video==${videoId}`
            });

            if (!res.data.rows || res.data.rows.length === 0) {
                return null;
            }

            const firstRow = res.data.rows[0];
            return parseAnalyticsRow(firstRow as Array<string | number>, metrics);
        } catch (error) {
            lastError = error;
            continue;
        }
    }

    throw lastError ?? new Error('Failed fetching YouTube analytics');
}
