import { describe, expect, it } from 'vitest';
import { createTestSchema } from '../src/validation';

function makeBasePayload() {
    return {
        videoId: 'dQw4w9WgXcQ',
        titleA: 'Original title',
        titleB: 'Variant title',
        thumbnailA: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
        thumbnailB: 'https://example.com/variant.jpg',
        durationDays: 7
    };
}

describe('createTestSchema thumbnail validation', () => {
    it('accepts an uploaded image in data URL format for thumbnailB', () => {
        const payload = makeBasePayload();
        payload.thumbnailB = 'data:image/png;base64,QUJDRA==';

        const result = createTestSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    it('rejects unsupported data URL image types', () => {
        const payload = makeBasePayload();
        payload.thumbnailB = 'data:image/gif;base64,QUJDRA==';

        const result = createTestSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it('rejects uploaded images larger than 2MB', () => {
        const payload = makeBasePayload();
        payload.thumbnailB = `data:image/jpeg;base64,${'A'.repeat(2_900_000)}`;

        const result = createTestSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });
});
