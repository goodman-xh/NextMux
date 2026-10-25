/** Immutable, permissively licensed weights; downloaded to app data, never shipped in the repository. */
export type CanvasOnDeviceOperation = 'image.matting' | 'image.depth';
export interface CanvasOnDeviceModel {
    readonly id: string;
    readonly url: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly downloadMiB: number;
    readonly inputSize: number;
    readonly inputName: string;
    readonly outputName?: string;
    readonly license: 'Apache-2.0';
}
export const CANVAS_ON_DEVICE_MODELS: Readonly<Record<CanvasOnDeviceOperation, CanvasOnDeviceModel>> = Object.freeze({
    'image.matting': Object.freeze({
        id: 'u2netp-7112208d',
        url: 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8/onnx/model.onnx',
        sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
        byteLength: 4_574_861, downloadMiB: 4.4, inputSize: 320, inputName: 'input.1', outputName: '1959', license: 'Apache-2.0'
    }),
    'image.depth': Object.freeze({
        id: 'depth-anything-v2-small-int8-4472b736',
        url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx',
        sha256: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d',
        byteLength: 27_258_801, downloadMiB: 26.0, inputSize: 518, inputName: 'pixel_values', outputName: 'predicted_depth', license: 'Apache-2.0'
    })
});
