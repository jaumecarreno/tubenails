import { z } from 'zod';

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{6,20}$/;
const PLAIN_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{3,50}$/;
const ALLOWED_DURATIONS = [4, 7, 14] as const;
const DATA_IMAGE_URL_REGEX = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i;

const MAX_THUMBNAIL_UPLOAD_BYTES = 2 * 1024 * 1024;

function isHttpUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function getDataUrlBytes(value: string): number | null {
    const match = value.match(DATA_IMAGE_URL_REGEX);
    if (!match) {
        return null;
    }

    try {
        const buffer = Buffer.from(match[2], 'base64');
        return buffer.length;
    } catch {
        return null;
    }
}

function isDataImageUrl(value: string): boolean {
    return DATA_IMAGE_URL_REGEX.test(value);
}

function isValidThumbnailSource(value: string): boolean {
    return isHttpUrl(value) || isDataImageUrl(value);
}

function isWithinThumbnailLimit(value: string): boolean {
    const bytes = getDataUrlBytes(value);
    if (bytes === null) {
        return true;
    }
    return bytes > 0 && bytes <= MAX_THUMBNAIL_UPLOAD_BYTES;
}

export function extractYoutubeVideoId(rawValue: string): string | null {
    const input = rawValue.trim();
    if (!input) {
        return null;
    }

    if (YOUTUBE_ID_REGEX.test(input)) {
        return input;
    }

    try {
        const url = new URL(input);
        const hostname = url.hostname.replace(/^www\./, '').toLowerCase();

        if (hostname === 'youtu.be') {
            const candidate = url.pathname.replace('/', '');
            return YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
        }

        if (hostname.endsWith('youtube.com')) {
            const queryVideoId = url.searchParams.get('v');
            if (queryVideoId && YOUTUBE_ID_REGEX.test(queryVideoId)) {
                return queryVideoId;
            }

            const pathSegments = url.pathname.split('/').filter(Boolean);
            const shortsIndex = pathSegments.indexOf('shorts');
            if (shortsIndex >= 0) {
                const shortsId = pathSegments[shortsIndex + 1];
                return shortsId && YOUTUBE_ID_REGEX.test(shortsId) ? shortsId : null;
            }
        }
    } catch {
        // The value is not a URL. Continue with plain ID validation.
    }

    return PLAIN_VIDEO_ID_REGEX.test(input) ? input : null;
}

export const createTestSchema = z.object({
    videoId: z
        .string()
        .trim()
        .min(1, 'videoId is required')
        .transform((value) => extractYoutubeVideoId(value))
        .refine((value) => value !== null, 'videoId is invalid'),
    titleA: z.string().trim().min(1, 'titleA is required').max(255, 'titleA is too long'),
    titleB: z.string().trim().max(255, 'titleB is too long').optional().default(''),
    thumbnailA: z
        .string()
        .trim()
        .max(2048, 'thumbnailA is too long')
        .refine((value) => isHttpUrl(value), 'thumbnailA must be a valid HTTP/HTTPS URL'),
    thumbnailB: z
        .string()
        .trim()
        .min(1, 'thumbnailB is required')
        .max(3_000_000, 'thumbnailB payload is too large')
        .refine((value) => isValidThumbnailSource(value), 'thumbnailB must be an image URL or uploaded image data')
        .refine((value) => isWithinThumbnailLimit(value), 'Uploaded thumbnail must be <= 2MB'),
    durationDays: z
        .coerce
        .number()
        .int('durationDays must be an integer')
        .refine((value): value is (typeof ALLOWED_DURATIONS)[number] => {
            return ALLOWED_DURATIONS.includes(value as (typeof ALLOWED_DURATIONS)[number]);
        }, 'durationDays must be one of 4, 7 or 14')
}).transform((value) => ({
    ...value,
    videoId: value.videoId as string,
    titleB: value.titleB || value.titleA
}));

export const testIdParamSchema = z.object({
    id: z.string().uuid('Invalid test id')
});

export const applyWinnerSchema = z.object({
    variant: z.enum(['A', 'B'], { message: 'variant must be A or B' })
});

export function formatZodError(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}
