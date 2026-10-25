import assert from 'node:assert/strict';
import test from 'node:test';

const { searchStockMedia, stockFileName, downloadStockMedia, StockMediaError } = await import('../lib/node/nextmux-stock-media.js');
const { stockQueryFromPrompt } = await import('../lib/common/nextmux-stock-media.js');

test('a shot picture prompt becomes a short stock query', () => {
    assert.equal(stockQueryFromPrompt('A rainy city street at night, neon reflections on wet asphalt, cinematic'), 'rainy city street at night');
    assert.equal(stockQueryFromPrompt('Close-up of a coffee cup. Warm light.'), 'coffee cup');
    assert.equal(stockQueryFromPrompt('', '雨夜街道'), '雨夜街道');
});

test('Pexels clips: the key goes in the header, orientation and length decide, used clips are skipped', async () => {
    let request;
    const fetchImpl = async (url, init) => { request = { url: new URL(url), headers: init.headers }; return Response.json({ videos: [
        { id: 1, url: 'https://www.pexels.com/video/1', duration: 3, user: { name: 'A' }, video_files: [{ file_type: 'video/mp4', link: 'https://videos.pexels.com/1.mp4', width: 1920, height: 1080 }] },
        { id: 2, url: 'https://www.pexels.com/video/2', duration: 12, user: { name: 'Bo' }, video_files: [
            { file_type: 'video/mp4', link: 'https://videos.pexels.com/2-4k.mp4', width: 2160, height: 3840 },
            { file_type: 'video/mp4', link: 'https://videos.pexels.com/2-hd.mp4', width: 1080, height: 1920 }] },
        { id: 3, url: 'https://www.pexels.com/video/3', duration: 20, user: { name: 'C' }, video_files: [{ file_type: 'video/mp4', link: 'https://videos.pexels.com/3.mp4', width: 1080, height: 1920 }] },
    ] }); };
    const pick = await searchStockMedia({ provider: 'pexels', key: 'pexels-secret-key', query: '雨夜街道', kind: 'video', orientation: 'portrait', minSeconds: 6, locale: 'zh-CN', exclude: new Set(['pexels:3']) }, fetchImpl);
    assert.equal(request.url.hostname, 'api.pexels.com');
    assert.equal(request.url.searchParams.get('locale'), 'zh-CN');
    assert.equal(request.headers.authorization, 'pexels-secret-key');
    assert.equal(request.url.toString().includes('pexels-secret-key'), false);
    assert.equal(pick.id, '2');
    assert.equal(pick.downloadUrl, 'https://videos.pexels.com/2-hd.mp4', 'at most 1080p');
    assert.equal(stockFileName(pick), 'Pexels 2 · Bo.mp4');
});

test('Pixabay pictures, and a rejected key is reported without the key', async () => {
    const pick = await searchStockMedia({ provider: 'pixabay', key: 'pixabay-secret', query: 'mountain lake', kind: 'image', orientation: 'landscape' },
        async () => Response.json({ hits: [{ id: 9, pageURL: 'https://pixabay.com/photos/9', largeImageURL: 'https://pixabay.com/get/9.jpg', imageWidth: 1920, imageHeight: 1280, user: 'Kim' }] }));
    assert.equal(pick.kind, 'image');
    assert.equal(pick.author, 'Kim');
    await assert.rejects(searchStockMedia({ provider: 'pixabay', key: 'pixabay-secret', query: 'x y z', kind: 'image', orientation: 'square' }, async () => new Response('', { status: 401 })),
        error => error instanceof StockMediaError && error.code === 'STOCK_KEY_REJECTED' && !error.message.includes('pixabay-secret'));
});

test('downloads come only from the provider’s own hosts', async () => {
    await assert.rejects(downloadStockMedia({ provider: 'pexels', id: '1', kind: 'image', downloadUrl: 'https://evil.example/1.jpg', extension: 'jpg', width: 1, height: 1, author: 'a', pageUrl: '' },
        '/tmp/never-written.jpg', async () => { throw new Error('fetched'); }), error => error.code === 'STOCK_UNAVAILABLE' && error.data.domainError.code === 'STOCK_DOWNLOAD_URL_INVALID');
});

test('provider transport failures do not retain credential-bearing URLs in diagnostics', async () => {
    await assert.rejects(searchStockMedia({ provider: 'pixabay', key: 'private-test-key', query: 'x', kind: 'image', orientation: 'square' },
        async url => { throw new Error(`Failed to fetch ${url}`); }), error => {
            assert.equal(error.domainError.code, 'STOCK_NETWORK_FAILED');
            assert.doesNotMatch(JSON.stringify(error), /private-test-key/);
            assert.doesNotMatch(error.message, /private-test-key/);
            return true;
        });
});
