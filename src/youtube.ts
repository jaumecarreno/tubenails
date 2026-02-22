import { google } from 'googleapis';
import { getClientForUser } from './auth';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

// Helper to download an image from a URL to a temporary local file
// YouTube's thumbnails.set requires a media stream/file, not just a URL.
async function downloadImageToTemp(url: string, filepath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(filepath, () => { });
            reject(err);
        });
    });
}


export async function getChannelVideos(userId: string, maxResults: number = 10) {
    const auth = await getClientForUser(userId);
    const youtube = google.youtube({ version: 'v3', auth });

    // Step 1: Get the channel's "Uploads" playlist ID (Cost: 1 API Unit)
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

    // Step 2: Fetch the videos from the "Uploads" playlist (Cost: 1 API Unit)
    const playlistRes = await youtube.playlistItems.list({
        part: ['snippet'],
        playlistId: uploadsPlaylistId,
        maxResults: maxResults
    });

    if (!playlistRes.data.items) {
        return { channelId, videos: [] };
    }

    const videos = playlistRes.data.items.map(item => ({
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

export async function updateVideoThumbnail(userId: string, videoId: string, thumbnailUrl: string) {
    const auth = await getClientForUser(userId);
    const youtube = google.youtube({ version: 'v3', auth });

    const tempFilePath = path.join(__dirname, `../temp_thumb_${videoId}_${Date.now()}.jpg`);

    try {
        await downloadImageToTemp(thumbnailUrl, tempFilePath);

        const res = await youtube.thumbnails.set({
            videoId: videoId,
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

    // First, we need to get the existing video snippet to preserve categoryId, description etc.
    const videoParams = await youtube.videos.list({
        part: ['snippet'],
        id: [videoId]
    });

    if (!videoParams.data.items || videoParams.data.items.length === 0) {
        throw new Error('Video not found');
    }

    const snippet = videoParams.data.items[0].snippet;

    if (!snippet) throw new Error('Snippet is missing');

    // Update title
    snippet.title = newTitle;

    // YouTube API sometimes requires categoryId in the update payload
    if (!snippet.categoryId) snippet.categoryId = "22";

    const res = await youtube.videos.update({
        part: ['snippet'],
        requestBody: {
            id: videoId,
            snippet: snippet
        }
    });

    console.log(`Title updated for video ${videoId} to "${newTitle}"`);
    return res.data;
}

export async function getDailyAnalytics(userId: string, videoId: string, dateStr: string) {
    const auth = await getClientForUser(userId);
    const analytics = google.youtubeAnalytics({ version: 'v2', auth });

    // Use thumbnail-impression metrics so estimated clicks can be calculated as
    // impressions * (impressionsCtr / 100).
    const res = await analytics.reports.query({
        ids: 'channel==MINE',
        startDate: dateStr,
        endDate: dateStr,
        metrics: 'impressions,impressionsCtr',
        dimensions: 'day,video',
        filters: `video==${videoId}`
    });

    return res.data;
}
