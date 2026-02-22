import { z } from 'zod';

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{6,20}$/;
const PLAIN_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{3,50}$/;
const ALLOWED_DURATIONS = [4, 7, 14] as const;

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
    thumbnailA: z.string().trim().url('thumbnailA must be a valid URL').max(2048, 'thumbnailA is too long'),
    thumbnailB: z.string().trim().url('thumbnailB must be a valid URL').max(2048, 'thumbnailB is too long'),
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

export function formatZodError(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}
