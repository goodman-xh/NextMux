// Technical fields extracted verbatim from canvas-spec.md §22.
// Presentation aliases are deliberately omitted; numeric pricing is archival data, not supplier pricing.
import type { CanvasRegistrySnapshot } from './canvas-model-registry.js';

export const CANVAS_REGISTRY_SNAPSHOT: CanvasRegistrySnapshot = {
  "capturedDate": "2026-10-01",
  "timezone": "Asia/Shanghai",
  "videoModels": [
    {
      "value": "doubao-seedance-2-5-260628",
      "provider": "DOUBAO",
      "refVideoBilling": 1,
      "supportAudio": 1,
      "supportAudioUpload": true,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 30,
      "supportDraft": false,
      "durationRange": {
        "min": 4,
        "max": 30,
        "step": 1
      },
      "membershipRequired": true,
      "allowedMembershipLevelCodes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": true,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 30,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 30,
        "maxReferenceVideos": 10,
        "maxReferenceAudios": 10,
        "comboLimits": {
          "audio_only": {
            "remark": "可只传参考音频，最多10段",
            "max_audios": 10
          },
          "image_only": {
            "remark": "参考图片最多30张",
            "max_images": 30
          },
          "video_only": {
            "remark": "参考视频最多10个",
            "max_videos": 10
          },
          "image_audio": {
            "remark": "参考图片最多30张，参考音频最多10段",
            "max_audios": 10,
            "max_images": 30
          },
          "image_video": {
            "remark": "参考图片最多30张，参考视频最多10个",
            "max_images": 30,
            "max_videos": 10
          },
          "video_audio": {
            "remark": "参考视频最多10个，参考音频最多10段",
            "max_audios": 10,
            "max_videos": 10
          },
          "image_video_audio": {
            "remark": "参考图片最多30张，参考视频最多10个，参考音频最多10段",
            "max_audios": 10,
            "max_images": 30,
            "max_videos": 10
          }
        },
        "extraLimits": {
          "audio_constraints": {
            "formats": [
              "wav",
              "mp3"
            ],
            "max_size_mb": 15,
            "duration_range_s": "2-15"
          },
          "edit_extend_tasks": {
            "video_edit": {
              "ratio": "adaptive",
              "duration": -1
            },
            "video_extend": {
              "ratio": "adaptive"
            }
          },
          "image_constraints": {
            "formats": [
              "jpeg",
              "png",
              "webp",
              "bmp",
              "tiff",
              "gif"
            ],
            "max_size_mb": 30,
            "aspect_ratio_range": "0.4-2.5"
          },
          "video_constraints": {
            "formats": [
              "mp4",
              "mov"
            ],
            "fps_range": "24-60",
            "max_size_mb": 50,
            "resolutions": [
              "480p",
              "720p",
              "1080p"
            ],
            "duration_range_s": "2-30"
          },
          "output_constraints": {
            "resolutions": [
              "480p",
              "720p",
              "1080p"
            ],
            "duration_range_s": "4-30"
          }
        }
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 250,
                  "pointsPerSecondWithAudio": 250,
                  "pointsPerSecondWithRefVideo": 200,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 615,
                  "pointsPerSecondWithAudio": 615,
                  "pointsPerSecondWithRefVideo": 615,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": {
        "audio": {
          "formats": [
            "wav",
            "mp3"
          ],
          "max_count": 10,
          "max_size_mb": 15,
          "max_duration": 15,
          "min_duration": 2
        },
        "image": {
          "formats": [
            "jpeg",
            "png",
            "webp",
            "bmp",
            "tiff",
            "gif"
          ],
          "max_count": 30,
          "max_size_mb": 30,
          "aspect_ratio_range": [
            0.4,
            2.5
          ]
        },
        "video": {
          "formats": [
            "mp4",
            "mov"
          ],
          "max_count": 10,
          "max_size_mb": 50,
          "max_duration": 30,
          "min_duration": 2
        }
      },
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "doubao-seedance-2-5-260628-draft",
      "provider": "DOUBAO",
      "refVideoBilling": 1,
      "supportAudio": 1,
      "supportAudioUpload": true,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 30,
      "supportDraft": false,
      "durationRange": {
        "min": 4,
        "max": 30,
        "step": 1
      },
      "membershipRequired": true,
      "allowedMembershipLevelCodes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": true,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 30,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 30,
        "maxReferenceVideos": 10,
        "maxReferenceAudios": 10,
        "comboLimits": {
          "audio_only": {
            "remark": "可只传参考音频，最多10段",
            "max_audios": 10
          },
          "image_only": {
            "remark": "参考图片最多30张",
            "max_images": 30
          },
          "video_only": {
            "remark": "参考视频最多10个",
            "max_videos": 10
          },
          "image_audio": {
            "remark": "参考图片最多30张，参考音频最多10段",
            "max_audios": 10,
            "max_images": 30
          },
          "image_video": {
            "remark": "参考图片最多30张，参考视频最多10个",
            "max_images": 30,
            "max_videos": 10
          },
          "video_audio": {
            "remark": "参考视频最多10个，参考音频最多10段",
            "max_audios": 10,
            "max_videos": 10
          },
          "image_video_audio": {
            "remark": "参考图片最多30张，参考视频最多10个，参考音频最多10段",
            "max_audios": 10,
            "max_images": 30,
            "max_videos": 10
          }
        },
        "extraLimits": {
          "audio_constraints": {
            "formats": [
              "wav",
              "mp3"
            ],
            "max_size_mb": 15,
            "duration_range_s": "2-15"
          },
          "edit_extend_tasks": {
            "video_edit": {
              "ratio": "adaptive",
              "duration": -1
            },
            "video_extend": {
              "ratio": "adaptive"
            }
          },
          "image_constraints": {
            "formats": [
              "jpeg",
              "png",
              "webp",
              "bmp",
              "tiff",
              "gif"
            ],
            "max_size_mb": 30,
            "aspect_ratio_range": "0.4-2.5"
          },
          "video_constraints": {
            "formats": [
              "mp4",
              "mov"
            ],
            "fps_range": "24-60",
            "max_size_mb": 50,
            "resolutions": [
              "480p",
              "720p",
              "1080p"
            ],
            "duration_range_s": "2-30"
          },
          "output_constraints": {
            "resolutions": [
              "480p"
            ],
            "duration_range_s": "4-30"
          }
        }
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 96,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": {
        "audio": {
          "formats": [
            "wav",
            "mp3"
          ],
          "max_count": 10,
          "max_size_mb": 15,
          "max_duration": 15,
          "min_duration": 2
        },
        "image": {
          "formats": [
            "jpeg",
            "png",
            "webp",
            "bmp",
            "tiff",
            "gif"
          ],
          "max_count": 30,
          "max_size_mb": 30,
          "aspect_ratio_range": [
            0.4,
            2.5
          ]
        },
        "video": {
          "formats": [
            "mp4",
            "mov"
          ],
          "max_count": 10,
          "max_size_mb": 50,
          "max_duration": 30,
          "min_duration": 2
        }
      },
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "neo-video-2-0",
      "provider": "DOUBAO",
      "refVideoBilling": 1,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 9,
      "supportDraft": false,
      "durationRange": {
        "min": 4,
        "max": 15,
        "step": 1
      },
      "membershipRequired": true,
      "allowedMembershipLevelCodes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 9,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 9,
        "maxReferenceVideos": 3,
        "maxReferenceAudios": 3,
        "comboLimits": {
          "image_only": {
            "remark": "参考图片最多9张",
            "max_images": 9
          },
          "image_audio": {
            "max_audios": 3,
            "max_images": 9
          },
          "image_video": {
            "remark": "参考图片最多9张，参考视频最多3个",
            "max_images": 9,
            "max_videos": 3
          },
          "image_video_audio": {
            "max_audios": 3,
            "max_images": 9,
            "max_videos": 3
          }
        },
        "extraLimits": {
          "audio_constraints": {
            "formats": [
              "wav",
              "mp3"
            ],
            "max_size_mb": 15,
            "duration_range_s": "2-15"
          },
          "image_constraints": {
            "formats": [
              "jpeg",
              "png",
              "webp",
              "bmp",
              "tiff",
              "gif"
            ],
            "max_size_mb": 30,
            "aspect_ratio_range": "0.4-2.5"
          },
          "video_constraints": {
            "formats": [
              "mp4",
              "mov"
            ],
            "fps_range": "24-60",
            "max_size_mb": 50,
            "resolutions": [
              "480p",
              "720p"
            ],
            "duration_range_s": "2-15"
          }
        }
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4k",
              "name": "4k",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4k",
              "name": "4k",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 42,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 150,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": 90,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 375,
                  "pointsPerSecondWithAudio": 375,
                  "pointsPerSecondWithRefVideo": 220,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4k",
              "name": "4k",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 780,
                  "pointsPerSecondWithAudio": 780,
                  "pointsPerSecondWithRefVideo": 460,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "neo-video-2-0-fast",
      "provider": "DOUBAO",
      "refVideoBilling": 1,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 9,
      "supportDraft": false,
      "durationRange": {
        "min": 4,
        "max": 15,
        "step": 1
      },
      "membershipRequired": true,
      "allowedMembershipLevelCodes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 9,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 9,
        "maxReferenceVideos": 3,
        "maxReferenceAudios": 3,
        "comboLimits": {
          "image_only": {
            "remark": "参考图片最多9张",
            "max_images": 9
          },
          "image_audio": {
            "max_audios": 3,
            "max_images": 9
          },
          "image_video": {
            "remark": "参考图片最多9张，参考视频最多3个",
            "max_images": 9,
            "max_videos": 3
          },
          "image_video_audio": {
            "max_audios": 3,
            "max_images": 9,
            "max_videos": 3
          }
        },
        "extraLimits": {
          "audio_constraints": {
            "formats": [
              "wav",
              "mp3"
            ],
            "max_size_mb": 15,
            "duration_range_s": "2-15"
          },
          "image_constraints": {
            "formats": [
              "jpeg",
              "png",
              "webp",
              "bmp",
              "tiff",
              "gif"
            ],
            "max_size_mb": 30,
            "aspect_ratio_range": "0.4-2.5"
          },
          "video_constraints": {
            "formats": [
              "mp4",
              "mov"
            ],
            "fps_range": "24-60",
            "max_size_mb": 50,
            "resolutions": [
              "480p",
              "720p"
            ],
            "duration_range_s": "2-15"
          },
          "output_constraints": {
            "duration_range_s": "4-12"
          }
        }
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 55,
                  "pointsPerSecondWithAudio": 55,
                  "pointsPerSecondWithRefVideo": 33,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 66,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "doubao-seedance-2-0-mini-260615",
      "provider": "DOUBAO",
      "refVideoBilling": 1,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 9,
      "supportDraft": false,
      "durationRange": {
        "min": 4,
        "max": 15,
        "step": 1
      },
      "membershipRequired": true,
      "allowedMembershipLevelCodes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 9,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 9,
        "maxReferenceVideos": 3,
        "maxReferenceAudios": 3,
        "comboLimits": {
          "image_only": {
            "remark": "参考图片最多9张",
            "max_images": 9
          },
          "image_audio": {
            "max_audios": 3,
            "max_images": 9
          },
          "image_video": {
            "remark": "参考图片最多9张，参考视频最多3个",
            "max_images": 9,
            "max_videos": 3
          },
          "image_video_audio": {
            "max_audios": 3,
            "max_images": 9,
            "max_videos": 3
          }
        },
        "extraLimits": {
          "audio_constraints": {
            "formats": [
              "wav",
              "mp3"
            ],
            "max_size_mb": 15,
            "duration_range_s": "2-15"
          },
          "image_constraints": {
            "formats": [
              "jpeg",
              "png",
              "webp",
              "bmp",
              "tiff",
              "gif"
            ],
            "max_size_mb": 30,
            "aspect_ratio_range": "0.4-2.5"
          },
          "video_constraints": {
            "formats": [
              "mp4",
              "mov"
            ],
            "fps_range": "24-60",
            "max_size_mb": 50,
            "resolutions": [
              "480p",
              "720p"
            ],
            "duration_range_s": "2-15"
          },
          "output_constraints": {
            "duration_range_s": "4-12"
          }
        }
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "480p",
              "name": "480p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 35,
                  "pointsPerSecondWithAudio": 35,
                  "pointsPerSecondWithRefVideo": 25,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "MiniMax-H3",
      "provider": "MINIMAX",
      "refVideoBilling": 1,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 9,
      "supportDraft": false,
      "durationRange": {
        "min": 5,
        "max": 15,
        "step": 1
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 9,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 9,
        "maxReferenceVideos": 3,
        "maxReferenceAudios": 3,
        "comboLimits": {
          "image_only": {
            "remark": "参考图片最多9张",
            "max_images": 9
          },
          "video_only": {
            "remark": "参考视频最多3个",
            "max_videos": 3
          },
          "image_audio": {
            "remark": "参考图片最多9张，参考音频最多3个",
            "max_audios": 3,
            "max_images": 9
          },
          "image_video": {
            "remark": "参考图片最多9张，参考视频最多3个",
            "max_images": 9,
            "max_videos": 3
          },
          "video_audio": {
            "remark": "参考视频最多3个，参考音频最多3个",
            "max_audios": 3,
            "max_videos": 3
          },
          "image_video_audio": {
            "remark": "参考图片最多9张，参考视频最多3个，参考音频最多3个",
            "max_audios": 3,
            "max_images": 9,
            "max_videos": 3
          }
        },
        "extraLimits": {
          "audio_constraints": {
            "formats": [
              "wav",
              "mp3"
            ],
            "max_size_mb": 15,
            "duration_range_s": "2-15",
            "total_duration_s": 15
          },
          "image_constraints": {
            "formats": [
              "jpg",
              "jpeg",
              "png",
              "webp",
              "heic",
              "heif"
            ],
            "max_size_mb": 30,
            "side_range_px": "256-5760",
            "aspect_ratio_range": "0.4-2.5"
          },
          "video_constraints": {
            "codecs": [
              "h264",
              "h265"
            ],
            "formats": [
              "mp4",
              "mov"
            ],
            "fps_range": "23.976-60",
            "max_size_mb": 50,
            "side_range_px": "256-5760",
            "duration_range_s": "2-15",
            "total_duration_s": 15,
            "aspect_ratio_range": "0.4-2.5"
          },
          "output_constraints": {
            "resolutions": [
              "2K"
            ],
            "duration_range_s": "4-15"
          },
          "request_constraints": {
            "remark": "大文件必须走公网URL，不要用Base64",
            "max_body_size_mb": 64
          }
        }
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "768P",
              "name": "768P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "2K",
              "name": "2K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "768P",
              "name": "768P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "2K",
              "name": "2K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "768P",
              "name": "768P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "2K",
              "name": "2K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 110,
                  "pointsPerSecondWithAudio": 110,
                  "pointsPerSecondWithRefVideo": 110,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "MiniMax-H3-Max",
      "provider": "MINIMAX",
      "refVideoBilling": 1,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 9,
      "supportDraft": false,
      "durationRange": {
        "min": 5,
        "max": 15,
        "step": 1
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 9,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 9,
        "maxReferenceVideos": 3,
        "maxReferenceAudios": 3,
        "comboLimits": {
          "image_only": {
            "remark": "参考图片最多9张",
            "max_images": 9
          },
          "video_only": {
            "remark": "参考视频最多3个",
            "max_videos": 3
          },
          "image_audio": {
            "remark": "参考图片最多9张，参考音频最多3个",
            "max_audios": 3,
            "max_images": 9
          },
          "image_video": {
            "remark": "参考图片最多9张，参考视频最多3个",
            "max_images": 9,
            "max_videos": 3
          },
          "video_audio": {
            "remark": "参考视频最多3个，参考音频最多3个",
            "max_audios": 3,
            "max_videos": 3
          },
          "image_video_audio": {
            "remark": "参考图片最多9张，参考视频最多3个，参考音频最多3个",
            "max_audios": 3,
            "max_images": 9,
            "max_videos": 3
          }
        },
        "extraLimits": {
          "audio_constraints": {
            "formats": [
              "wav",
              "mp3"
            ],
            "max_size_mb": 15,
            "duration_range_s": "2-15",
            "total_duration_s": 15
          },
          "image_constraints": {
            "formats": [
              "jpg",
              "jpeg",
              "png",
              "webp",
              "heic",
              "heif"
            ],
            "max_size_mb": 30,
            "side_range_px": "256-5760",
            "aspect_ratio_range": "0.4-2.5"
          },
          "video_constraints": {
            "codecs": [
              "h264",
              "h265"
            ],
            "formats": [
              "mp4",
              "mov"
            ],
            "fps_range": "23.976-60",
            "max_size_mb": 50,
            "side_range_px": "256-5760",
            "duration_range_s": "2-15",
            "total_duration_s": 15,
            "aspect_ratio_range": "0.4-2.5"
          },
          "output_constraints": {
            "resolutions": [
              "480P",
              "768P"
            ],
            "duration_range_s": "5-15"
          },
          "request_constraints": {
            "remark": "大文件必须走公网URL，不要用Base64",
            "max_body_size_mb": 64
          }
        }
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "480P",
              "name": "480P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "768P",
              "name": "768P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "480P",
              "name": "480P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "768P",
              "name": "768P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "480P",
              "name": "480P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 43,
                  "pointsPerSecondWithAudio": 43,
                  "pointsPerSecondWithRefVideo": 43,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "768P",
              "name": "768P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": 80,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "doubao-seedance-1-0-pro-fast-251015",
      "provider": "DOUBAO",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": false,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 3,
        "max": 10,
        "step": 1
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": false,
        "supportWatermark": true,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 12,
                  "pointsPerSecondWithAudio": 24,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 12,
                  "pointsPerSecondWithAudio": 24,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 12,
                  "pointsPerSecondWithAudio": 24,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 12,
                  "pointsPerSecondWithAudio": 24,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 12,
                  "pointsPerSecondWithAudio": 24,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 12,
                  "pointsPerSecondWithAudio": 24,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:21",
                  "name": "9:21",
                  "pointsPerSecond": 12,
                  "pointsPerSecondWithAudio": 24,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 24,
                  "pointsPerSecondWithAudio": 48,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 24,
                  "pointsPerSecondWithAudio": 48,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 24,
                  "pointsPerSecondWithAudio": 48,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 24,
                  "pointsPerSecondWithAudio": 48,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 24,
                  "pointsPerSecondWithAudio": 48,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 24,
                  "pointsPerSecondWithAudio": 48,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:21",
                  "name": "9:21",
                  "pointsPerSecond": 24,
                  "pointsPerSecondWithAudio": 48,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 12,
                  "pointsPerSecondWithAudio": 24,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 24,
                  "pointsPerSecondWithAudio": 48,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "doubao-seedance-1-0-pro-250528",
      "provider": "DOUBAO",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 2,
        "max": 10,
        "step": 1
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:21",
                  "name": "9:21",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 90,
                  "pointsPerSecondWithAudio": 180,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 90,
                  "pointsPerSecondWithAudio": 180,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 90,
                  "pointsPerSecondWithAudio": 180,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 90,
                  "pointsPerSecondWithAudio": 180,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 90,
                  "pointsPerSecondWithAudio": 180,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "21:9",
                  "name": "21:9",
                  "pointsPerSecond": 90,
                  "pointsPerSecondWithAudio": 180,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:21",
                  "name": "9:21",
                  "pointsPerSecond": 90,
                  "pointsPerSecondWithAudio": 180,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 90,
                  "pointsPerSecondWithAudio": 180,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "kling-v3",
      "provider": "KLING",
      "refVideoBilling": 0,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 3,
        "max": 15,
        "step": 1
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 60,
                  "pointsPerSecondWithAudio": 90,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 60,
                  "pointsPerSecondWithAudio": 90,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 60,
                  "pointsPerSecondWithAudio": 90,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4K",
              "name": "4K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 300,
                  "pointsPerSecondWithAudio": 300,
                  "pointsPerSecondWithRefVideo": 300,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 300,
                  "pointsPerSecondWithAudio": 300,
                  "pointsPerSecondWithRefVideo": 300,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 300,
                  "pointsPerSecondWithAudio": 300,
                  "pointsPerSecondWithRefVideo": 300,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 60,
                  "pointsPerSecondWithAudio": 90,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 80,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4K",
              "name": "4K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 300,
                  "pointsPerSecondWithAudio": 300,
                  "pointsPerSecondWithRefVideo": 300,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "kling-v2-6",
      "provider": "KLING",
      "refVideoBilling": 0,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 5,
        "max": 10,
        "step": 5
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "kling-v2-5",
      "provider": "KLING",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 5,
        "max": 10,
        "step": 5
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 30,
                  "pointsPerSecondWithAudio": 60,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 30,
                  "pointsPerSecondWithAudio": 60,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 30,
                  "pointsPerSecondWithAudio": 60,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 30,
                  "pointsPerSecondWithAudio": 60,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "kling-v2-1",
      "provider": "KLING",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 5,
        "max": 10,
        "step": 5
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 40,
                  "pointsPerSecondWithAudio": 80,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "vidu-q3-pro",
      "provider": "VIDU",
      "refVideoBilling": 0,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 5,
        "max": 16,
        "step": 1
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 94,
                  "pointsPerSecondWithAudio": 188,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 94,
                  "pointsPerSecondWithAudio": 188,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 94,
                  "pointsPerSecondWithAudio": 188,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 94,
                  "pointsPerSecondWithAudio": 188,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 94,
                  "pointsPerSecondWithAudio": 188,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 100,
                  "pointsPerSecondWithAudio": 200,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 100,
                  "pointsPerSecondWithAudio": 200,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 100,
                  "pointsPerSecondWithAudio": 200,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 100,
                  "pointsPerSecondWithAudio": 200,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 100,
                  "pointsPerSecondWithAudio": 200,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 94,
                  "pointsPerSecondWithAudio": 188,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 100,
                  "pointsPerSecondWithAudio": 200,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "2k",
              "name": "2k",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 200,
                  "pointsPerSecondWithAudio": 400,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "vidu-q2-pro",
      "provider": "VIDU",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 5,
        "max": 8,
        "step": 3
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 34,
                  "pointsPerSecondWithAudio": 68,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 72,
                  "pointsPerSecondWithAudio": 144,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "wan3.0-video",
      "provider": "WAN",
      "refVideoBilling": 1,
      "supportAudio": 0,
      "supportAudioUpload": true,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 1,
      "supportDraft": false,
      "durationRange": {
        "min": 2,
        "max": 30,
        "step": 1
      },
      "membershipRequired": true,
      "allowedMembershipLevelCodes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": true,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 1,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 10,
        "maxReferenceVideos": 5,
        "maxReferenceAudios": 5,
        "comboLimits": {
          "audio_only": {
            "remark": "参考音频最多5段，总时长不大于15秒",
            "max_audios": 5
          },
          "image_only": {
            "remark": "参考图片最多10张",
            "max_images": 10
          },
          "video_only": {
            "remark": "参考视频最多5段，总时长不大于15秒",
            "max_videos": 5
          },
          "image_audio": {
            "remark": "参考图片最多10张，参考音频最多5段且总时长不大于15秒",
            "max_audios": 5,
            "max_images": 10
          },
          "image_video": {
            "remark": "参考图片最多10张，参考视频最多5段且总时长不大于15秒",
            "max_images": 10,
            "max_videos": 5
          },
          "video_audio": {
            "remark": "参考视频最多5段且总时长不大于15秒，参考音频最多5段且总时长不大于15秒",
            "max_audios": 5,
            "max_videos": 5
          },
          "image_video_audio": {
            "remark": "参考图片最多10张，参考视频最多5段且总时长不大于15秒，参考音频最多5段且总时长不大于15秒",
            "max_audios": 5,
            "max_images": 10,
            "max_videos": 5
          }
        },
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "480P",
              "name": "480P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 45,
                  "pointsPerSecondWithAudio": 45,
                  "pointsPerSecondWithRefVideo": 45,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "720P",
              "name": "720P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 85,
                  "pointsPerSecondWithAudio": 85,
                  "pointsPerSecondWithRefVideo": 85,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080P",
              "name": "1080P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 170,
                  "pointsPerSecondWithAudio": 170,
                  "pointsPerSecondWithRefVideo": 170,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "wan2.7",
      "provider": "WAN",
      "refVideoBilling": 0,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 2,
        "max": 15,
        "step": 1
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": true,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": true,
        "supportReferenceVideo": true,
        "supportReferenceAudio": true,
        "maxReferenceImages": 5,
        "maxReferenceVideos": 1,
        "maxReferenceAudios": 1,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720P",
              "name": "720P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 70,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 70,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 70,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 70,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 70,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080P",
              "name": "1080P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 120,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 120,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 120,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 120,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 120,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720P",
              "name": "720P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 70,
                  "pointsPerSecondWithRefVideo": 70,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080P",
              "name": "1080P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 120,
                  "pointsPerSecondWithAudio": 120,
                  "pointsPerSecondWithRefVideo": 120,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "MiniMax-Hailuo-2.3",
      "provider": "MINIMAX",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": false,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 6,
        "max": 10,
        "step": 4
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": false,
        "supportWatermark": true,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "768p",
              "name": "768p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 75,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "768p",
              "name": "768p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 75,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "happyhorse-1.0",
      "provider": "HAPPY HORSE",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": false,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 9,
      "supportDraft": false,
      "durationRange": {
        "min": 3,
        "max": 15,
        "step": 1
      },
      "membershipRequired": true,
      "allowedMembershipLevelCodes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": false,
        "supportWatermark": false,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 9,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720P",
              "name": "720P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080P",
              "name": "1080P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720P",
              "name": "720P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080P",
              "name": "1080P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "720P",
              "name": "720P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 130,
                  "pointsPerSecondWithAudio": 130,
                  "pointsPerSecondWithRefVideo": 130,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080P",
              "name": "1080P",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "1:1",
                  "name": "1:1",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "4:3",
                  "name": "4:3",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "3:4",
                  "name": "3:4",
                  "pointsPerSecond": 230,
                  "pointsPerSecondWithAudio": 230,
                  "pointsPerSecondWithRefVideo": 230,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "MiniMax-Hailuo-2.3-Fast",
      "provider": "MINIMAX",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": false,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 6,
        "max": 10,
        "step": 4
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": false,
        "supportWatermark": true,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "768p",
              "name": "768p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 30,
                  "pointsPerSecondWithAudio": 60,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 52,
                  "pointsPerSecondWithAudio": 104,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "768p",
              "name": "768p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 30,
                  "pointsPerSecondWithAudio": 60,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 52,
                  "pointsPerSecondWithAudio": 104,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "MiniMax-Hailuo-02",
      "provider": "MINIMAX",
      "refVideoBilling": 0,
      "supportAudio": 0,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": false,
      "supportReferenceToVideoSize": 0,
      "supportDraft": false,
      "durationRange": {
        "min": 6,
        "max": 10,
        "step": 4
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 0,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": true,
        "supportReferenceToVideo": false,
        "supportReferenceToVideoSize": 0,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "768p",
              "name": "768p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 75,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "768p",
              "name": "768p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 50,
                  "pointsPerSecondWithAudio": 100,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 75,
                  "pointsPerSecondWithAudio": 150,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "veo-3.1-generate-001",
      "provider": "VEO",
      "refVideoBilling": 0,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 3,
      "supportDraft": false,
      "durationRange": {
        "min": 4,
        "max": 8,
        "step": 2
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 3,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4K",
              "name": "4K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 280,
                  "pointsPerSecondWithAudio": 560,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 280,
                  "pointsPerSecondWithAudio": 560,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4K",
              "name": "4K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 280,
                  "pointsPerSecondWithAudio": 560,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 280,
                  "pointsPerSecondWithAudio": 560,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 140,
                  "pointsPerSecondWithAudio": 280,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4K",
              "name": "4K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 280,
                  "pointsPerSecondWithAudio": 560,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 280,
                  "pointsPerSecondWithAudio": 560,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    },
    {
      "value": "veo-3.1-fast-generate-001",
      "provider": "VEO",
      "refVideoBilling": 0,
      "supportAudio": 1,
      "supportAudioUpload": false,
      "supportFirstLastFrame": true,
      "supportReferenceToVideo": true,
      "supportReferenceToVideoSize": 3,
      "supportDraft": false,
      "durationRange": {
        "min": 4,
        "max": 8,
        "step": 2
      },
      "membershipRequired": false,
      "allowedMembershipLevelCodes": [],
      "isUniversalModel": false,
      "featureConfig": {
        "supportAudioGeneration": 1,
        "supportAudioUpload": false,
        "supportDraft": false,
        "supportFirstLastFrame": true,
        "supportWatermark": false,
        "supportReferenceToVideo": true,
        "supportReferenceToVideoSize": 3,
        "supportReferenceImage": false,
        "supportReferenceVideo": false,
        "supportReferenceAudio": false,
        "maxReferenceImages": 0,
        "maxReferenceVideos": 0,
        "maxReferenceAudios": 0,
        "comboLimits": null,
        "extraLimits": null
      },
      "generationTypes": [
        {
          "value": "TEXT_TO_VIDEO",
          "name": "文生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4K",
              "name": "4K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 210,
                  "pointsPerSecondWithAudio": 420,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 210,
                  "pointsPerSecondWithAudio": 420,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "IMAGE_TO_VIDEO",
          "name": "图生视频",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4K",
              "name": "4K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 210,
                  "pointsPerSecondWithAudio": 420,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 210,
                  "pointsPerSecondWithAudio": 420,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        },
        {
          "value": "REFERENCE_TO_VIDEO",
          "name": "REFERENCE_TO_VIDEO",
          "resolutions": [
            {
              "value": "720p",
              "name": "720p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "1080p",
              "name": "1080p",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "auto",
                  "name": "auto",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 70,
                  "pointsPerSecondWithAudio": 140,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            },
            {
              "value": "4K",
              "name": "4K",
              "discountRate": null,
              "aspectRatios": [
                {
                  "value": "16:9",
                  "name": "16:9",
                  "pointsPerSecond": 210,
                  "pointsPerSecondWithAudio": 420,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                },
                {
                  "value": "9:16",
                  "name": "9:16",
                  "pointsPerSecond": 210,
                  "pointsPerSecondWithAudio": 420,
                  "pointsPerSecondWithRefVideo": null,
                  "pointsPerSecondWithAudioAndRefVideo": null
                }
              ]
            }
          ]
        }
      ],
      "mediaConstraints": null,
      "hasDiscount": false,
      "discountRate": null
    }
  ],
  "imageModels": [
    {
      "provider": "GPT",
      "model_id": 27,
      "model_name": "gpt-image-2.5-flare",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": true,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 16,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 116,
      "size_pricing_config": "{\"low_1k\": 7, \"low_2k\": 13, \"low_4k\": 22, \"max_1k\": 227, \"max_2k\": 462, \"max_4k\": 767, \"high_1k\": 57, \"high_2k\": 116, \"high_4k\": 192, \"xhigh_1k\": 101, \"xhigh_2k\": 205, \"xhigh_4k\": 341, \"medium_1k\": 15, \"medium_2k\": 29, \"medium_4k\": 48}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "jpeg",
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
        "2:1"
      ],
      "supported_sizes": [
        "1K",
        "2K",
        "4K"
      ],
      "quality": [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      "maintenance": false,
      "membership_required": 1,
      "allowed_membership_level_codes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "GPT",
      "model_id": 28,
      "model_name": "gpt-image-2.5-sunburst",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": true,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 16,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 116,
      "size_pricing_config": "{\"low_1k\": 7, \"low_2k\": 13, \"low_4k\": 22, \"max_1k\": 227, \"max_2k\": 462, \"max_4k\": 767, \"high_1k\": 57, \"high_2k\": 116, \"high_4k\": 192, \"xhigh_1k\": 101, \"xhigh_2k\": 205, \"xhigh_4k\": 341, \"medium_1k\": 15, \"medium_2k\": 29, \"medium_4k\": 48}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "jpeg",
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
        "2:1"
      ],
      "supported_sizes": [
        "1K",
        "2K",
        "4K"
      ],
      "quality": [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      "maintenance": false,
      "membership_required": 1,
      "allowed_membership_level_codes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "GPT",
      "model_id": 17,
      "model_name": "gpt-image-2",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": true,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 10,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 200,
      "size_pricing_config": "{\"low_1k\": 29, \"low_2k\": 42, \"low_4k\": 56, \"high_1k\": 154, \"high_2k\": 282, \"high_4k\": 452, \"medium_1k\": 57, \"medium_2k\": 89, \"medium_4k\": 132}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "png",
        "jpeg"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
        "2:1"
      ],
      "supported_sizes": [
        "1K",
        "2K",
        "4K"
      ],
      "quality": [
        "low",
        "medium",
        "high"
      ],
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "GPT",
      "model_id": 20,
      "model_name": "gpt-image-2-official",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": true,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 16,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 200,
      "size_pricing_config": "{\"low_1k\": 29, \"low_2k\": 42, \"low_4k\": 56, \"high_1k\": 154, \"high_2k\": 282, \"high_4k\": 452, \"medium_1k\": 57, \"medium_2k\": 89, \"medium_4k\": 132}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "jpeg",
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
        "2:1"
      ],
      "supported_sizes": [
        "1K",
        "2K",
        "4K"
      ],
      "quality": [
        "low",
        "medium",
        "high"
      ],
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "DOUBAO",
      "model_id": 24,
      "model_name": "doubao-seedream-5-0-pro-260628",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 10,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 25,
      "size_pricing_config": "{\"1K\": 50, \"2K\": 80}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 2,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "png"
      ],
      "supported_aspect_ratios": [
        "9:16",
        "16:9",
        "4:3",
        "3:4",
        "1:1",
        "3:2",
        "2:3",
        "21:9"
      ],
      "supported_sizes": [
        "1K",
        "2K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "WAN",
      "model_id": 26,
      "model_name": "qwen-image-3.0-pro",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": true,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 3,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 60,
      "size_pricing_config": "{\"1K\": 35, \"2K\": 70}",
      "free_reference_image_count": 0,
      "points_cost_per_reference_image": 2,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "5:4",
        "4:5"
      ],
      "supported_sizes": [
        "1k",
        "2k"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "DOUBAO",
      "model_id": 13,
      "model_name": "doubao-seedream-5-0-260128",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 10,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 25,
      "size_pricing_config": null,
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "png"
      ],
      "supported_aspect_ratios": [
        "9:16",
        "16:9",
        "4:3",
        "3:4",
        "1:1"
      ],
      "supported_sizes": [
        "2K",
        "3K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "DOUBAO",
      "model_id": 10,
      "model_name": "doubao-seedream-4-5-251128",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 4,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 30,
      "size_pricing_config": null,
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": null,
      "supported_aspect_ratios": [
        "9:16",
        "16:9",
        "4:3",
        "3:4",
        "1:1"
      ],
      "supported_sizes": [
        "2K",
        "4K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "DOUBAO",
      "model_id": 2,
      "model_name": "doubao-seedream-4-0-250828",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 4,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 25,
      "size_pricing_config": null,
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": null,
      "supported_aspect_ratios": [
        "9:16",
        "16:9",
        "4:3",
        "3:4",
        "1:1"
      ],
      "supported_sizes": [
        "2K",
        "4K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "GEMINI",
      "model_id": 9,
      "model_name": "gemini-3-pro-image-preview",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 10,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 100,
      "size_pricing_config": "{\"4K\": 200}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "jpeg",
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9"
      ],
      "supported_sizes": [
        "2K",
        "4K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 1,
      "allowed_membership_level_codes": [
        "PLUS",
        "PRO",
        "MAX",
        "TEAM",
        "ULTRA"
      ],
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "GEMINI",
      "model_id": 14,
      "model_name": "gemini-3.1-flash-image-preview",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 10,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 90,
      "size_pricing_config": "{\"1K\": 60, \"4K\": 120}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "jpeg",
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "5:4",
        "4:5",
        "21:9",
        "1:4",
        "4:1",
        "1:8",
        "8:1"
      ],
      "supported_sizes": [
        "1K",
        "2K",
        "4K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "GEMINI",
      "model_id": 23,
      "model_name": "gemini-3.1-flash-lite-image",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 14,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 30,
      "size_pricing_config": "{}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "jpeg",
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "5:4",
        "4:5",
        "21:9"
      ],
      "supported_sizes": [
        "1K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "GEMINI",
      "model_id": 1,
      "model_name": "gemini-2.5-flash-image",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": true,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 4,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 30,
      "size_pricing_config": null,
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "jpeg",
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "5:4",
        "4:5",
        "21:9"
      ],
      "supported_sizes": [
        "1K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "WAN",
      "model_id": 15,
      "model_name": "wan2.7-image-pro",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": true,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 10,
      "image_count_options": [
        "1",
        "4"
      ],
      "points_cost_per_image": 60,
      "size_pricing_config": "{}",
      "free_reference_image_count": 1,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "5:4",
        "4:5"
      ],
      "supported_sizes": [
        "1K",
        "2K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    },
    {
      "provider": "GEMINI",
      "model_id": 29,
      "model_name": "hy-image-3.5-preview",
      "model_type": "T2I,I2I",
      "display_type": 3,
      "is_default_design_model": false,
      "is_default_shot_model": false,
      "support_seed": false,
      "support_custom_aspect_ratio": true,
      "max_reference_images": 20,
      "image_count_options": [
        "1",
        "1"
      ],
      "points_cost_per_image": 18,
      "size_pricing_config": "{\"1K\": 18, \"2K\": 20, \"4K\": 25}",
      "free_reference_image_count": 20,
      "points_cost_per_reference_image": 0,
      "reference_image_billing_mode": 1,
      "supported_output_formats": [
        "jpeg",
        "png"
      ],
      "supported_aspect_ratios": [
        "1:1",
        "2:3",
        "3:2",
        "4:3",
        "9:16",
        "16:9",
        "21:9"
      ],
      "supported_sizes": [
        "1K",
        "2K",
        "4K"
      ],
      "quality": null,
      "maintenance": false,
      "membership_required": 0,
      "allowed_membership_level_codes": null,
      "has_discount": false,
      "discount_rate": null,
      "size_discount_config": null
    }
  ]
};
