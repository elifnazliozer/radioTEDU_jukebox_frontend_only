import { describe, expect, it } from 'vitest';
import extras from './kiosk-extras.js';

const { findNewRequests, pickAmbientColor, computeBurnInOffset } = extras;

describe('findNewRequests', () => {
    const queue = [
        { id: 'a', title: 'Kuzu Kuzu', added_by_name: 'Elif', queue_reason: 'user' },
        { id: 'b', title: 'Öp', added_by_name: 'Can', queue_reason: 'admin' },
        { id: 'c', title: 'Radio jingle', added_by_name: 'RadioTEDU', queue_reason: 'jingle' },
        { id: 'd', title: 'Autoplay pick', added_by_name: 'RadioTEDU', queue_reason: 'autoplay' },
    ];

    it('announces nothing on the first snapshot', () => {
        expect(findNewRequests(null, queue)).toEqual([]);
    });

    it('returns only songs people added since the last snapshot', () => {
        expect(findNewRequests(new Set(['a']), queue).map((item) => item.id)).toEqual(['b']);
    });
});

describe('pickAmbientColor', () => {
    const pixel = (r, g, b, a = 255) => [r, g, b, a];

    it('averages the colourful pixels and ignores grey, black and white', () => {
        const pixels = [
            ...pixel(200, 40, 40),
            ...pixel(220, 60, 20),
            ...pixel(128, 128, 128),
            ...pixel(5, 5, 5),
            ...pixel(250, 250, 250),
        ];
        expect(pickAmbientColor(pixels)).toBe('210, 50, 30');
    });

    it('returns null for a cover with no usable colour', () => {
        expect(pickAmbientColor([...pixel(10, 10, 10), ...pixel(240, 240, 240)])).toBeNull();
    });
});

describe('computeBurnInOffset', () => {
    it('stays within a few pixels in both directions', () => {
        expect(computeBurnInOffset(() => 0)).toEqual({ x: -4, y: -4 });
        expect(computeBurnInOffset(() => 1)).toEqual({ x: 4, y: 4 });
        expect(computeBurnInOffset(() => 0.5)).toEqual({ x: 0, y: 0 });
    });
});
