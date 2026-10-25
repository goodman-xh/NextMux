import { createSceneDocument, createSceneObject, mirrorScenePosture, normalizeScene } from "./director-scene.js";
import type { SceneDocument, SceneObject, ScenePosture, SceneVector } from "./director-scene.js";
export interface ScenePosePreset { readonly id:string; readonly label:string; readonly posture:ScenePosture }
export interface ScenePropPreset { readonly id:string; readonly name:string; readonly category:string; readonly subcategory:string; readonly icon:string; readonly defaultColor:string; readonly defaultScale:SceneVector }
export interface SceneCameraPreset { readonly id:string; readonly label:string; readonly position:SceneVector; readonly lookAt:SceneVector; readonly fov:number }
export interface SceneBodyType { readonly id:string; readonly label:string; readonly icon:string; readonly description:string }
export interface SceneTemplateCharacter { readonly offset:{readonly x:number;readonly z:number;readonly y?:number}; readonly rotation?:number; readonly pose:string; readonly role:string; readonly bodyType?:string; readonly color?:string; readonly mirrorPose?:boolean }
export interface SceneTemplateProp { readonly assetId:string; readonly position:SceneVector; readonly rotation?:number; readonly scale?:SceneVector|number; readonly color?:string }
export type SceneTemplateCamera = Omit<SceneCameraPreset,"id"> & {readonly id?:string};
export interface SceneTemplate { readonly id:string; readonly label:string; readonly category:string; readonly description:string; readonly characters:readonly SceneTemplateCharacter[]; readonly cameras:readonly SceneTemplateCamera[]; readonly props:readonly SceneTemplateProp[] }
export interface SceneJointGroup {readonly group:string;readonly joints:readonly {readonly key:string;readonly label:string;readonly props:readonly {readonly key:string;readonly label:string;readonly min:number;readonly max:number}[]}[]}
/** Original configuration snapshot specified by canvas spec §26; no remote assets. */
export const SCENE_POSES: readonly ScenePosePreset[] = [
  {
    "id": "stand",
    "label": "站立",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 2,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -10,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": -5,
        "straddle": 7,
        "turn": 0
      },
      "r_arm": {
        "raise": -5,
        "straddle": 7,
        "turn": 0
      },
      "l_elbow": {
        "bend": 15
      },
      "r_elbow": {
        "bend": 15
      },
      "l_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "tpose",
    "label": "T型",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": 0,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 0,
        "straddle": 90,
        "turn": 0
      },
      "r_arm": {
        "raise": 0,
        "straddle": 90,
        "turn": 0
      },
      "l_elbow": {
        "bend": 0
      },
      "r_elbow": {
        "bend": 0
      },
      "l_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "walk",
    "label": "行走",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 3,
        "turn": 5,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 20,
        "straddle": 5,
        "turn": 0
      },
      "r_arm": {
        "raise": -15,
        "straddle": 5,
        "turn": 0
      },
      "l_elbow": {
        "bend": 25
      },
      "r_elbow": {
        "bend": 40
      },
      "l_leg": {
        "raise": -10,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": 25,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 5
      },
      "r_knee": {
        "bend": 40
      }
    }
  },
  {
    "id": "run",
    "label": "跑步",
    "posture": {
      "body": {
        "bend": 10,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 5,
        "turn": 5,
        "tilt": 0
      },
      "head": {
        "nod": -10,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": -30,
        "straddle": 5,
        "turn": 0
      },
      "r_arm": {
        "raise": 40,
        "straddle": 5,
        "turn": 0
      },
      "l_elbow": {
        "bend": 60
      },
      "r_elbow": {
        "bend": 90
      },
      "l_leg": {
        "raise": 50,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": -20,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 30
      },
      "r_knee": {
        "bend": 60
      }
    }
  },
  {
    "id": "jump",
    "label": "跳跃",
    "posture": {
      "body": {
        "bend": -5,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": -5,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -15,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 20,
        "straddle": 130,
        "turn": 0
      },
      "r_arm": {
        "raise": 20,
        "straddle": 130,
        "turn": 0
      },
      "l_elbow": {
        "bend": 20
      },
      "r_elbow": {
        "bend": 20
      },
      "l_leg": {
        "raise": -15,
        "straddle": 15,
        "turn": 0
      },
      "r_leg": {
        "raise": 30,
        "straddle": 15,
        "turn": 0
      },
      "l_knee": {
        "bend": 30
      },
      "r_knee": {
        "bend": 50
      }
    }
  },
  {
    "id": "kick",
    "label": "踢球",
    "posture": {
      "body": {
        "bend": -5,
        "turn": -10,
        "tilt": 5
      },
      "torso": {
        "bend": -5,
        "turn": -10,
        "tilt": 5
      },
      "head": {
        "nod": 5,
        "turn": -10,
        "tilt": 0
      },
      "l_arm": {
        "raise": -20,
        "straddle": 30,
        "turn": 0
      },
      "r_arm": {
        "raise": 20,
        "straddle": 25,
        "turn": 0
      },
      "l_elbow": {
        "bend": 40
      },
      "r_elbow": {
        "bend": 35
      },
      "l_leg": {
        "raise": -10,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": 80,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 10
      },
      "r_knee": {
        "bend": 20
      }
    }
  },
  {
    "id": "throw",
    "label": "投掷",
    "posture": {
      "body": {
        "bend": 5,
        "turn": 20,
        "tilt": 0
      },
      "torso": {
        "bend": 5,
        "turn": 15,
        "tilt": -5
      },
      "head": {
        "nod": -5,
        "turn": -20,
        "tilt": 0
      },
      "l_arm": {
        "raise": 30,
        "straddle": 30,
        "turn": 0
      },
      "r_arm": {
        "raise": 140,
        "straddle": 30,
        "turn": 20
      },
      "l_elbow": {
        "bend": 40
      },
      "r_elbow": {
        "bend": 40
      },
      "l_leg": {
        "raise": 15,
        "straddle": 5,
        "turn": 0
      },
      "r_leg": {
        "raise": -10,
        "straddle": 5,
        "turn": 0
      },
      "l_knee": {
        "bend": 20
      },
      "r_knee": {
        "bend": 5
      }
    }
  },
  {
    "id": "push",
    "label": "推",
    "posture": {
      "body": {
        "bend": 15,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 10,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 60,
        "straddle": 10,
        "turn": 0
      },
      "r_arm": {
        "raise": 60,
        "straddle": 10,
        "turn": 0
      },
      "l_elbow": {
        "bend": 30
      },
      "r_elbow": {
        "bend": 30
      },
      "l_leg": {
        "raise": 20,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": -15,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 35
      },
      "r_knee": {
        "bend": 10
      }
    }
  },
  {
    "id": "sit",
    "label": "坐姿",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 5,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 0,
        "straddle": 8,
        "turn": 0
      },
      "r_arm": {
        "raise": 0,
        "straddle": 8,
        "turn": 0
      },
      "l_elbow": {
        "bend": 80
      },
      "r_elbow": {
        "bend": 80
      },
      "l_leg": {
        "raise": 90,
        "straddle": 5,
        "turn": 0
      },
      "r_leg": {
        "raise": 90,
        "straddle": 5,
        "turn": 0
      },
      "l_knee": {
        "bend": 90
      },
      "r_knee": {
        "bend": 90
      }
    }
  },
  {
    "id": "squat",
    "label": "蹲下",
    "posture": {
      "body": {
        "bend": 15,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 10,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -15,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 20,
        "straddle": 15,
        "turn": 0
      },
      "r_arm": {
        "raise": 20,
        "straddle": 15,
        "turn": 0
      },
      "l_elbow": {
        "bend": 30
      },
      "r_elbow": {
        "bend": 30
      },
      "l_leg": {
        "raise": 100,
        "straddle": 15,
        "turn": 0
      },
      "r_leg": {
        "raise": 100,
        "straddle": 15,
        "turn": 0
      },
      "l_knee": {
        "bend": 140
      },
      "r_knee": {
        "bend": 140
      }
    }
  },
  {
    "id": "kneel",
    "label": "单膝跪",
    "posture": {
      "body": {
        "bend": 5,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 5,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "r_arm": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "l_elbow": {
        "bend": 30
      },
      "r_elbow": {
        "bend": 30
      },
      "l_leg": {
        "raise": 70,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": -10,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 90
      },
      "r_knee": {
        "bend": 140
      }
    }
  },
  {
    "id": "kneel2",
    "label": "双膝跪",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 3,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": -5,
        "straddle": 5,
        "turn": 0
      },
      "r_arm": {
        "raise": -5,
        "straddle": 5,
        "turn": 0
      },
      "l_elbow": {
        "bend": 15
      },
      "r_elbow": {
        "bend": 15
      },
      "l_leg": {
        "raise": -10,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": -10,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 145
      },
      "r_knee": {
        "bend": 145
      }
    }
  },
  {
    "id": "lie",
    "label": "躺",
    "posture": {
      "body": {
        "bend": -90,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": 15,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": -5,
        "straddle": 16,
        "turn": 0
      },
      "r_arm": {
        "raise": -5,
        "straddle": 16,
        "turn": 0
      },
      "l_elbow": {
        "bend": 10
      },
      "r_elbow": {
        "bend": 10
      },
      "l_leg": {
        "raise": 0,
        "straddle": 6,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 6,
        "turn": 0
      },
      "l_knee": {
        "bend": 5
      },
      "r_knee": {
        "bend": 5
      }
    }
  },
  {
    "id": "wave",
    "label": "招手",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 2,
        "turn": -10,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": 15,
        "tilt": 5
      },
      "l_arm": {
        "raise": -5,
        "straddle": 7,
        "turn": 0
      },
      "r_arm": {
        "raise": 0,
        "straddle": 120,
        "turn": 0
      },
      "l_elbow": {
        "bend": 15
      },
      "r_elbow": {
        "bend": 110
      },
      "l_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "point",
    "label": "指向",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 2,
        "turn": -15,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": -20,
        "tilt": 0
      },
      "l_arm": {
        "raise": -5,
        "straddle": 7,
        "turn": 0
      },
      "r_arm": {
        "raise": 80,
        "straddle": 20,
        "turn": 0
      },
      "l_elbow": {
        "bend": 15
      },
      "r_elbow": {
        "bend": 5
      },
      "l_leg": {
        "raise": 0,
        "straddle": 5,
        "turn": 0
      },
      "r_leg": {
        "raise": 5,
        "straddle": 5,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 5
      }
    }
  },
  {
    "id": "hands_up",
    "label": "举手",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": -3,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 140,
        "straddle": 7,
        "turn": 0
      },
      "r_arm": {
        "raise": 140,
        "straddle": 7,
        "turn": 0
      },
      "l_elbow": {
        "bend": 15
      },
      "r_elbow": {
        "bend": 15
      },
      "l_leg": {
        "raise": 0,
        "straddle": 5,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 5,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "celebrate",
    "label": "庆祝",
    "posture": {
      "body": {
        "bend": -5,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": -5,
        "turn": 0,
        "tilt": 5
      },
      "head": {
        "nod": -20,
        "turn": 0,
        "tilt": -5
      },
      "l_arm": {
        "raise": 0,
        "straddle": 145,
        "turn": 50
      },
      "r_arm": {
        "raise": 0,
        "straddle": 155,
        "turn": 50
      },
      "l_elbow": {
        "bend": 30
      },
      "r_elbow": {
        "bend": 15
      },
      "l_leg": {
        "raise": 0,
        "straddle": 15,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 15,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "bow",
    "label": "鞠躬",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 40,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": 20,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": -5,
        "straddle": 5,
        "turn": 0
      },
      "r_arm": {
        "raise": -5,
        "straddle": 5,
        "turn": 0
      },
      "l_elbow": {
        "bend": 5
      },
      "r_elbow": {
        "bend": 5
      },
      "l_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "present",
    "label": "演讲",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 2,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -8,
        "turn": 5,
        "tilt": 0
      },
      "l_arm": {
        "raise": 30,
        "straddle": 30,
        "turn": 0
      },
      "r_arm": {
        "raise": 50,
        "straddle": 40,
        "turn": 0
      },
      "l_elbow": {
        "bend": 40
      },
      "r_elbow": {
        "bend": 60
      },
      "l_leg": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "akimbo",
    "label": "叉腰",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": -20,
        "straddle": 40,
        "turn": 0
      },
      "r_arm": {
        "raise": -20,
        "straddle": 40,
        "turn": 0
      },
      "l_elbow": {
        "bend": 120
      },
      "r_elbow": {
        "bend": 120
      },
      "l_leg": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "cross_arms",
    "label": "抱臂",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": -8,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 30,
        "straddle": -5,
        "turn": 30
      },
      "r_arm": {
        "raise": 30,
        "straddle": -5,
        "turn": -30
      },
      "l_elbow": {
        "bend": 130
      },
      "r_elbow": {
        "bend": 130
      },
      "l_leg": {
        "raise": 0,
        "straddle": 5,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 5,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "think",
    "label": "思考",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 5,
        "turn": -5,
        "tilt": 0
      },
      "head": {
        "nod": 10,
        "turn": -10,
        "tilt": 5
      },
      "l_arm": {
        "raise": -5,
        "straddle": 7,
        "turn": 0
      },
      "r_arm": {
        "raise": 60,
        "straddle": 20,
        "turn": 0
      },
      "l_elbow": {
        "bend": 15
      },
      "r_elbow": {
        "bend": 140
      },
      "l_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 0,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "lean",
    "label": "倚靠",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": -5
      },
      "torso": {
        "bend": -3,
        "turn": 5,
        "tilt": -5
      },
      "head": {
        "nod": -10,
        "turn": 10,
        "tilt": -5
      },
      "l_arm": {
        "raise": -5,
        "straddle": 7,
        "turn": 0
      },
      "r_arm": {
        "raise": -10,
        "straddle": 5,
        "turn": 0
      },
      "l_elbow": {
        "bend": 15
      },
      "r_elbow": {
        "bend": 20
      },
      "l_leg": {
        "raise": 0,
        "straddle": 5,
        "turn": 0
      },
      "r_leg": {
        "raise": 20,
        "straddle": 0,
        "turn": 10
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 40
      }
    }
  },
  {
    "id": "stretch",
    "label": "伸懒腰",
    "posture": {
      "body": {
        "bend": -5,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": -8,
        "turn": 0,
        "tilt": 3
      },
      "head": {
        "nod": -25,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 10,
        "straddle": 170,
        "turn": 60
      },
      "r_arm": {
        "raise": 10,
        "straddle": 170,
        "turn": 60
      },
      "l_elbow": {
        "bend": 10
      },
      "r_elbow": {
        "bend": 10
      },
      "l_leg": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "phone",
    "label": "看手机",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 0,
        "tilt": 0
      },
      "torso": {
        "bend": 5,
        "turn": 0,
        "tilt": 0
      },
      "head": {
        "nod": 30,
        "turn": 0,
        "tilt": 0
      },
      "l_arm": {
        "raise": 30,
        "straddle": 0,
        "turn": 0
      },
      "r_arm": {
        "raise": 30,
        "straddle": 0,
        "turn": 0
      },
      "l_elbow": {
        "bend": 120
      },
      "r_elbow": {
        "bend": 120
      },
      "l_leg": {
        "raise": 0,
        "straddle": 5,
        "turn": 0
      },
      "r_leg": {
        "raise": 0,
        "straddle": 5,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 0
      }
    }
  },
  {
    "id": "photo",
    "label": "拍照",
    "posture": {
      "body": {
        "bend": 5,
        "turn": -10,
        "tilt": 0
      },
      "torso": {
        "bend": 5,
        "turn": -5,
        "tilt": 0
      },
      "head": {
        "nod": 5,
        "turn": -5,
        "tilt": 5
      },
      "l_arm": {
        "raise": 40,
        "straddle": 15,
        "turn": 0
      },
      "r_arm": {
        "raise": 50,
        "straddle": 20,
        "turn": 0
      },
      "l_elbow": {
        "bend": 100
      },
      "r_elbow": {
        "bend": 90
      },
      "l_leg": {
        "raise": 0,
        "straddle": 10,
        "turn": 0
      },
      "r_leg": {
        "raise": 5,
        "straddle": 10,
        "turn": 0
      },
      "l_knee": {
        "bend": 0
      },
      "r_knee": {
        "bend": 5
      }
    }
  },
  {
    "id": "fight",
    "label": "格斗",
    "posture": {
      "body": {
        "bend": 5,
        "turn": 15,
        "tilt": 0
      },
      "torso": {
        "bend": 8,
        "turn": 10,
        "tilt": 0
      },
      "head": {
        "nod": -5,
        "turn": -15,
        "tilt": 0
      },
      "l_arm": {
        "raise": 60,
        "straddle": 30,
        "turn": 0
      },
      "r_arm": {
        "raise": 40,
        "straddle": 25,
        "turn": 0
      },
      "l_elbow": {
        "bend": 110
      },
      "r_elbow": {
        "bend": 100
      },
      "l_leg": {
        "raise": 10,
        "straddle": 15,
        "turn": 10
      },
      "r_leg": {
        "raise": -5,
        "straddle": 15,
        "turn": -10
      },
      "l_knee": {
        "bend": 25
      },
      "r_knee": {
        "bend": 30
      }
    }
  },
  {
    "id": "dance",
    "label": "舞蹈",
    "posture": {
      "body": {
        "bend": 0,
        "turn": 10,
        "tilt": -10
      },
      "torso": {
        "bend": 5,
        "turn": -15,
        "tilt": 10
      },
      "head": {
        "nod": -5,
        "turn": 20,
        "tilt": -10
      },
      "l_arm": {
        "raise": 30,
        "straddle": 120,
        "turn": 0
      },
      "r_arm": {
        "raise": -10,
        "straddle": 60,
        "turn": 0
      },
      "l_elbow": {
        "bend": 40
      },
      "r_elbow": {
        "bend": 90
      },
      "l_leg": {
        "raise": 0,
        "straddle": 20,
        "turn": 10
      },
      "r_leg": {
        "raise": 35,
        "straddle": -5,
        "turn": 0
      },
      "l_knee": {
        "bend": 5
      },
      "r_knee": {
        "bend": 60
      }
    }
  }
];
export const SCENE_PROPS: readonly ScenePropPreset[] = [
  {
    "id": "cube",
    "name": "灰色立方体",
    "category": "primitive",
    "subcategory": "立方体",
    "icon": "🧊",
    "defaultColor": "#B8C0CC",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "cube_red",
    "name": "红色立方体",
    "category": "primitive",
    "subcategory": "立方体",
    "icon": "🟥",
    "defaultColor": "#E95C5C",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "cube_blue",
    "name": "蓝色立方体",
    "category": "primitive",
    "subcategory": "立方体",
    "icon": "🟦",
    "defaultColor": "#4F8EF7",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "cube_green",
    "name": "绿色立方体",
    "category": "primitive",
    "subcategory": "立方体",
    "icon": "🟩",
    "defaultColor": "#34C759",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "sphere",
    "name": "灰色球体",
    "category": "primitive",
    "subcategory": "球体",
    "icon": "⚪",
    "defaultColor": "#B8C0CC",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "sphere_red",
    "name": "红色球体",
    "category": "primitive",
    "subcategory": "球体",
    "icon": "🔴",
    "defaultColor": "#E95C5C",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "sphere_blue",
    "name": "蓝色球体",
    "category": "primitive",
    "subcategory": "球体",
    "icon": "🔵",
    "defaultColor": "#4F8EF7",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "sphere_green",
    "name": "绿色球体",
    "category": "primitive",
    "subcategory": "球体",
    "icon": "🟢",
    "defaultColor": "#34C759",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "cuboid",
    "name": "长方体",
    "category": "primitive",
    "subcategory": "多面体",
    "icon": "▬",
    "defaultColor": "#C4CAD4",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "cylinder",
    "name": "圆柱体",
    "category": "primitive",
    "subcategory": "旋转体",
    "icon": "🛢️",
    "defaultColor": "#C4CAD4",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "cone",
    "name": "圆锥体",
    "category": "primitive",
    "subcategory": "旋转体",
    "icon": "🔺",
    "defaultColor": "#C4CAD4",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "pyramid",
    "name": "四棱锥",
    "category": "primitive",
    "subcategory": "多面体",
    "icon": "🔺",
    "defaultColor": "#C4CAD4",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "torus",
    "name": "圆环体",
    "category": "primitive",
    "subcategory": "旋转体",
    "icon": "⭕",
    "defaultColor": "#C4CAD4",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "capsule",
    "name": "胶囊体",
    "category": "primitive",
    "subcategory": "旋转体",
    "icon": "💊",
    "defaultColor": "#C4CAD4",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "plane",
    "name": "基础平面",
    "category": "primitive",
    "subcategory": "平面",
    "icon": "▭",
    "defaultColor": "#C4CAD4",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "chair",
    "name": "椅子",
    "category": "furniture",
    "subcategory": "座椅",
    "icon": "🪑",
    "defaultColor": "#CBA877",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "table_rect",
    "name": "方桌",
    "category": "furniture",
    "subcategory": "桌子",
    "icon": "🪵",
    "defaultColor": "#BE9A68",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "table_round",
    "name": "圆桌",
    "category": "furniture",
    "subcategory": "桌子",
    "icon": "🟤",
    "defaultColor": "#BE9A68",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "sofa",
    "name": "沙发",
    "category": "furniture",
    "subcategory": "座椅",
    "icon": "🛋️",
    "defaultColor": "#4A6FA5",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "wall_2m",
    "name": "墙段 2m",
    "category": "structure",
    "subcategory": "墙体",
    "icon": "🧱",
    "defaultColor": "#ECE8E1",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "wall_3m",
    "name": "墙段 3m",
    "category": "structure",
    "subcategory": "墙体",
    "icon": "🧱",
    "defaultColor": "#ECE8E1",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "pillar",
    "name": "柱子",
    "category": "structure",
    "subcategory": "柱体",
    "icon": "🏛️",
    "defaultColor": "#D8CCBA",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "stairs",
    "name": "楼梯段",
    "category": "structure",
    "subcategory": "楼梯",
    "icon": "🪜",
    "defaultColor": "#B8ADA0",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "tree_small",
    "name": "小树",
    "category": "nature",
    "subcategory": "植物",
    "icon": "🌲",
    "defaultColor": "#2D8B2D",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "tree_large",
    "name": "大树",
    "category": "nature",
    "subcategory": "植物",
    "icon": "🌳",
    "defaultColor": "#228B22",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "rock",
    "name": "石头",
    "category": "nature",
    "subcategory": "岩石",
    "icon": "🪨",
    "defaultColor": "#7A7A7A",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "bush",
    "name": "灌木",
    "category": "nature",
    "subcategory": "植物",
    "icon": "🌿",
    "defaultColor": "#3A9D3A",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "car",
    "name": "轿车",
    "category": "vehicle",
    "subcategory": "汽车",
    "icon": "🚗",
    "defaultColor": "#2563EB",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "bicycle",
    "name": "自行车",
    "category": "vehicle",
    "subcategory": "自行车",
    "icon": "🚲",
    "defaultColor": "#2A2A2A",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "streetlamp",
    "name": "路灯",
    "category": "facility",
    "subcategory": "照明",
    "icon": "💡",
    "defaultColor": "#444444",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "bench",
    "name": "长椅",
    "category": "facility",
    "subcategory": "休憩",
    "icon": "🪑",
    "defaultColor": "#8B6914",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "trash_bin",
    "name": "垃圾桶",
    "category": "facility",
    "subcategory": "设施",
    "icon": "🗑️",
    "defaultColor": "#4A5568",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "arrow_marker",
    "name": "方向箭头",
    "category": "marker",
    "subcategory": "标记",
    "icon": "➡️",
    "defaultColor": "#FF4444",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "area_marker",
    "name": "区域标记",
    "category": "marker",
    "subcategory": "标记",
    "icon": "⬜",
    "defaultColor": "#FFAA00",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  },
  {
    "id": "image_board",
    "name": "图片板",
    "category": "image",
    "subcategory": "图片",
    "icon": "🖼️",
    "defaultColor": "#444444",
    "defaultScale": {
      "x": 1.0,
      "y": 1.0,
      "z": 1.0
    }
  }
];
export const SCENE_CAMERAS: readonly SceneCameraPreset[] = [
  {
    "id": "front_medium",
    "label": "正面中景",
    "position": {
      "x": 0,
      "y": 1.6,
      "z": 5
    },
    "lookAt": {
      "x": 0,
      "y": 1.2,
      "z": 0
    },
    "fov": 50
  },
  {
    "id": "front_close",
    "label": "正面特写",
    "position": {
      "x": 0,
      "y": 1.6,
      "z": 2
    },
    "lookAt": {
      "x": 0,
      "y": 1.5,
      "z": 0
    },
    "fov": 35
  },
  {
    "id": "front_wide",
    "label": "正面全景",
    "position": {
      "x": 0,
      "y": 1.8,
      "z": 8
    },
    "lookAt": {
      "x": 0,
      "y": 1,
      "z": 0
    },
    "fov": 65
  },
  {
    "id": "side_follow",
    "label": "侧面跟拍",
    "position": {
      "x": 3,
      "y": 1.5,
      "z": 3
    },
    "lookAt": {
      "x": 0,
      "y": 1.2,
      "z": 0
    },
    "fov": 60
  },
  {
    "id": "side_close",
    "label": "侧面近景",
    "position": {
      "x": 2,
      "y": 1.6,
      "z": 0
    },
    "lookAt": {
      "x": 0,
      "y": 1.4,
      "z": 0
    },
    "fov": 40
  },
  {
    "id": "back_medium",
    "label": "背面中景",
    "position": {
      "x": 0,
      "y": 1.6,
      "z": -4
    },
    "lookAt": {
      "x": 0,
      "y": 1.2,
      "z": 0
    },
    "fov": 50
  },
  {
    "id": "top_overview",
    "label": "俯拍全景",
    "position": {
      "x": 0,
      "y": 10,
      "z": 5
    },
    "lookAt": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "fov": 70
  },
  {
    "id": "top_45",
    "label": "45° 俯拍",
    "position": {
      "x": 0,
      "y": 6,
      "z": 6
    },
    "lookAt": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "fov": 55
  },
  {
    "id": "low_angle",
    "label": "低角度仰拍",
    "position": {
      "x": 0,
      "y": 0.5,
      "z": 3
    },
    "lookAt": {
      "x": 0,
      "y": 1.6,
      "z": 0
    },
    "fov": 50
  },
  {
    "id": "low_wide",
    "label": "低角度广角",
    "position": {
      "x": 0,
      "y": 0.3,
      "z": 2.5
    },
    "lookAt": {
      "x": 0,
      "y": 1.2,
      "z": 0
    },
    "fov": 80
  },
  {
    "id": "over_shoulder",
    "label": "过肩镜头",
    "position": {
      "x": -0.5,
      "y": 1.7,
      "z": 1
    },
    "lookAt": {
      "x": 0,
      "y": 1.5,
      "z": -2
    },
    "fov": 45
  },
  {
    "id": "over_shoulder_r",
    "label": "过肩镜头 (右)",
    "position": {
      "x": 0.5,
      "y": 1.7,
      "z": 1
    },
    "lookAt": {
      "x": 0,
      "y": 1.5,
      "z": -2
    },
    "fov": 45
  },
  {
    "id": "bird_eye",
    "label": "鸟瞰",
    "position": {
      "x": 0,
      "y": 15,
      "z": 0.1
    },
    "lookAt": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "fov": 45
  },
  {
    "id": "dutch_angle",
    "label": "荷兰角",
    "position": {
      "x": 2,
      "y": 1.8,
      "z": 3
    },
    "lookAt": {
      "x": 0,
      "y": 1.3,
      "z": 0
    },
    "fov": 50
  },
  {
    "id": "tracking_wide",
    "label": "远景跟踪",
    "position": {
      "x": 5,
      "y": 2,
      "z": 8
    },
    "lookAt": {
      "x": 0,
      "y": 1,
      "z": 0
    },
    "fov": 35
  },
  {
    "id": "pov_eye",
    "label": "POV 第一视角",
    "position": {
      "x": 0,
      "y": 1.6,
      "z": 0
    },
    "lookAt": {
      "x": 0,
      "y": 1.5,
      "z": -3
    },
    "fov": 75
  }
];
export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    "id": "empty",
    "label": "空白场景",
    "category": "基础",
    "description": "纯网格 + 默认机位，从零开始搭建",
    "characters": [],
    "cameras": [
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      }
    ],
    "props": []
  },
  {
    "id": "talking_head",
    "label": "单人口播",
    "category": "口播 · 解说",
    "description": "主播正对镜头讲解，特写 + 中景双机位",
    "characters": [
      {
        "offset": {
          "x": 0,
          "z": 0
        },
        "rotation": 0,
        "pose": "present",
        "role": "主播"
      }
    ],
    "cameras": [
      {
        "id": "front_close",
        "label": "正面特写",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 2
        },
        "lookAt": {
          "x": 0,
          "y": 1.5,
          "z": 0
        },
        "fov": 35
      },
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      }
    ],
    "props": []
  },
  {
    "id": "product_demo",
    "label": "产品讲解",
    "category": "口播 · 解说",
    "description": "讲解员立于桌后介绍产品，含产品俯视特写机位",
    "characters": [
      {
        "offset": {
          "x": 0,
          "z": -0.7
        },
        "rotation": 0,
        "pose": "point",
        "role": "讲解员"
      }
    ],
    "cameras": [
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "product_close",
        "label": "产品特写",
        "position": {
          "x": 0,
          "y": 1.4,
          "z": 1.5
        },
        "lookAt": {
          "x": 0,
          "y": 0.85,
          "z": 0
        },
        "fov": 40
      }
    ],
    "props": [
      {
        "assetId": "table_rect",
        "position": {
          "x": 0,
          "y": 0,
          "z": 0
        }
      },
      {
        "assetId": "image_board",
        "position": {
          "x": 0,
          "y": 0,
          "z": -2
        }
      }
    ]
  },
  {
    "id": "board_present",
    "label": "展板讲解",
    "category": "口播 · 解说",
    "description": "讲解员侧身配合展示板说明，适合知识科普类",
    "characters": [
      {
        "offset": {
          "x": -0.7,
          "z": 0
        },
        "rotation": 20,
        "pose": "present",
        "role": "讲解员"
      }
    ],
    "cameras": [
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "side_close",
        "label": "侧面近景",
        "position": {
          "x": 2,
          "y": 1.6,
          "z": 0
        },
        "lookAt": {
          "x": 0,
          "y": 1.4,
          "z": 0
        },
        "fov": 40
      }
    ],
    "props": [
      {
        "assetId": "image_board",
        "position": {
          "x": 0.9,
          "y": 0,
          "z": -0.6
        },
        "rotation": -18
      }
    ]
  },
  {
    "id": "dialogue_two",
    "label": "双人对话",
    "category": "对话 · 访谈",
    "description": "2 人面对面交谈，中景 + 左右过肩机位",
    "characters": [
      {
        "offset": {
          "x": -0.9,
          "z": 0
        },
        "rotation": 90,
        "pose": "present",
        "role": "角色A"
      },
      {
        "offset": {
          "x": 0.9,
          "z": 0
        },
        "rotation": -90,
        "pose": "think",
        "role": "角色B"
      }
    ],
    "cameras": [
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      },
      {
        "label": "过肩镜头",
        "position": {
          "x": -1.5,
          "y": 1.55,
          "z": 0.5
        },
        "lookAt": {
          "x": 0.9,
          "y": 1.45,
          "z": 0
        },
        "fov": 45
      },
      {
        "label": "过肩镜头 (右)",
        "position": {
          "x": 1.5,
          "y": 1.55,
          "z": 0.5
        },
        "lookAt": {
          "x": -0.9,
          "y": 1.45,
          "z": 0
        },
        "fov": 45
      }
    ],
    "props": []
  },
  {
    "id": "sofa_interview",
    "label": "访谈节目",
    "category": "对话 · 访谈",
    "description": "主持与嘉宾沙发对坐，茶几居中，演播室构图",
    "characters": [
      {
        "offset": {
          "x": -1.2,
          "y": -0.48,
          "z": 0
        },
        "rotation": 90,
        "pose": "sit",
        "role": "主持人"
      },
      {
        "offset": {
          "x": 1.2,
          "y": -0.48,
          "z": 0
        },
        "rotation": -90,
        "pose": "sit",
        "role": "嘉宾"
      }
    ],
    "cameras": [
      {
        "id": "front_wide",
        "label": "正面全景",
        "position": {
          "x": 0,
          "y": 1.8,
          "z": 8
        },
        "lookAt": {
          "x": 0,
          "y": 1,
          "z": 0
        },
        "fov": 65
      },
      {
        "label": "过肩镜头",
        "position": {
          "x": -1.95,
          "y": 1.3,
          "z": 0.6
        },
        "lookAt": {
          "x": 1.2,
          "y": 1.05,
          "z": 0
        },
        "fov": 45
      },
      {
        "label": "过肩镜头 (右)",
        "position": {
          "x": 1.95,
          "y": 1.3,
          "z": 0.6
        },
        "lookAt": {
          "x": -1.2,
          "y": 1.05,
          "z": 0
        },
        "fov": 45
      }
    ],
    "props": [
      {
        "assetId": "sofa",
        "position": {
          "x": -1.2,
          "y": 0,
          "z": 0
        },
        "rotation": 90
      },
      {
        "assetId": "sofa",
        "position": {
          "x": 1.2,
          "y": 0,
          "z": 0
        },
        "rotation": -90
      },
      {
        "assetId": "table_round",
        "position": {
          "x": 0,
          "y": 0,
          "z": 0
        }
      }
    ]
  },
  {
    "id": "street_interview",
    "label": "街头采访",
    "category": "对话 · 访谈",
    "description": "记者持麦提问路人，街景陪衬",
    "characters": [
      {
        "offset": {
          "x": -0.5,
          "z": 0
        },
        "rotation": 75,
        "pose": "point",
        "role": "记者"
      },
      {
        "offset": {
          "x": 0.6,
          "z": 0
        },
        "rotation": -80,
        "pose": "stand",
        "role": "受访者"
      }
    ],
    "cameras": [
      {
        "id": "side_close",
        "label": "侧面近景",
        "position": {
          "x": 2,
          "y": 1.6,
          "z": 0
        },
        "lookAt": {
          "x": 0,
          "y": 1.4,
          "z": 0
        },
        "fov": 40
      },
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      }
    ],
    "props": [
      {
        "assetId": "streetlamp",
        "position": {
          "x": 2.2,
          "y": 0,
          "z": -1.5
        }
      },
      {
        "assetId": "tree_small",
        "position": {
          "x": -2.5,
          "y": 0,
          "z": -2
        }
      }
    ]
  },
  {
    "id": "roundtable",
    "label": "圆桌讨论",
    "category": "对话 · 访谈",
    "description": "4 人围圆桌而坐，俯拍 + 中景 + 过肩机位",
    "characters": [
      {
        "offset": {
          "x": 0,
          "y": -0.45,
          "z": -0.85
        },
        "rotation": 0,
        "pose": "sit",
        "role": "成员A"
      },
      {
        "offset": {
          "x": 0.85,
          "y": -0.45,
          "z": 0
        },
        "rotation": -90,
        "pose": "sit",
        "role": "成员B"
      },
      {
        "offset": {
          "x": 0,
          "y": -0.45,
          "z": 0.85
        },
        "rotation": 180,
        "pose": "sit",
        "role": "成员C"
      },
      {
        "offset": {
          "x": -0.85,
          "y": -0.45,
          "z": 0
        },
        "rotation": 90,
        "pose": "sit",
        "role": "成员D"
      }
    ],
    "cameras": [
      {
        "id": "top_45",
        "label": "45° 俯拍",
        "position": {
          "x": 0,
          "y": 6,
          "z": 6
        },
        "lookAt": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "fov": 55
      },
      {
        "label": "斜侧中景",
        "position": {
          "x": 2.4,
          "y": 1.7,
          "z": 3.4
        },
        "lookAt": {
          "x": 0,
          "y": 0.8,
          "z": 0
        },
        "fov": 50
      },
      {
        "label": "过肩镜头",
        "position": {
          "x": 0.6,
          "y": 1.3,
          "z": -1.9
        },
        "lookAt": {
          "x": 0,
          "y": 0.95,
          "z": 0.85
        },
        "fov": 45
      }
    ],
    "props": [
      {
        "assetId": "table_round",
        "position": {
          "x": 0,
          "y": 0,
          "z": 0
        }
      },
      {
        "assetId": "chair",
        "position": {
          "x": 0,
          "y": 0,
          "z": -0.85
        }
      },
      {
        "assetId": "chair",
        "position": {
          "x": 0.85,
          "y": 0,
          "z": 0
        },
        "rotation": -90
      },
      {
        "assetId": "chair",
        "position": {
          "x": 0,
          "y": 0,
          "z": 0.85
        },
        "rotation": 180
      },
      {
        "assetId": "chair",
        "position": {
          "x": -0.85,
          "y": 0,
          "z": 0
        },
        "rotation": 90
      }
    ]
  },
  {
    "id": "classroom",
    "label": "课堂教学",
    "category": "教学 · 演讲",
    "description": "讲师立于讲台，4 名学员两排落座听讲",
    "characters": [
      {
        "offset": {
          "x": 0,
          "z": -2.2
        },
        "rotation": 0,
        "pose": "present",
        "role": "讲师"
      },
      {
        "offset": {
          "x": -0.9,
          "y": -0.45,
          "z": 0.6
        },
        "rotation": 180,
        "pose": "sit",
        "role": "学员A"
      },
      {
        "offset": {
          "x": 0.9,
          "y": -0.45,
          "z": 0.6
        },
        "rotation": 180,
        "pose": "sit",
        "role": "学员B"
      },
      {
        "offset": {
          "x": -0.9,
          "y": -0.45,
          "z": 1.8
        },
        "rotation": 180,
        "pose": "sit",
        "role": "学员C"
      },
      {
        "offset": {
          "x": 0.9,
          "y": -0.45,
          "z": 1.8
        },
        "rotation": 180,
        "pose": "sit",
        "role": "学员D"
      }
    ],
    "cameras": [
      {
        "id": "front_wide",
        "label": "正面全景",
        "position": {
          "x": 0,
          "y": 1.8,
          "z": 8
        },
        "lookAt": {
          "x": 0,
          "y": 1,
          "z": 0
        },
        "fov": 65
      },
      {
        "id": "back_medium",
        "label": "背面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": -4
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "top_45",
        "label": "45° 俯拍",
        "position": {
          "x": 0,
          "y": 6,
          "z": 6
        },
        "lookAt": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "fov": 55
      }
    ],
    "props": [
      {
        "assetId": "table_rect",
        "position": {
          "x": 0,
          "y": 0,
          "z": -1.6
        }
      },
      {
        "assetId": "chair",
        "position": {
          "x": -0.9,
          "y": 0,
          "z": 0.6
        },
        "rotation": 180
      },
      {
        "assetId": "chair",
        "position": {
          "x": 0.9,
          "y": 0,
          "z": 0.6
        },
        "rotation": 180
      },
      {
        "assetId": "chair",
        "position": {
          "x": -0.9,
          "y": 0,
          "z": 1.8
        },
        "rotation": 180
      },
      {
        "assetId": "chair",
        "position": {
          "x": 0.9,
          "y": 0,
          "z": 1.8
        },
        "rotation": 180
      }
    ]
  },
  {
    "id": "stage_speech",
    "label": "舞台演讲",
    "category": "教学 · 演讲",
    "description": "演讲者配大屏背景，观众背影入画，低角度增强气势",
    "characters": [
      {
        "offset": {
          "x": 0,
          "z": -2
        },
        "rotation": 0,
        "pose": "present",
        "role": "演讲者"
      },
      {
        "offset": {
          "x": -1.2,
          "z": 2.2
        },
        "rotation": 180,
        "pose": "stand",
        "role": "观众A"
      },
      {
        "offset": {
          "x": 0,
          "z": 2.4
        },
        "rotation": 180,
        "pose": "stand",
        "role": "观众B"
      },
      {
        "offset": {
          "x": 1.2,
          "z": 2.2
        },
        "rotation": 180,
        "pose": "stand",
        "role": "观众C"
      }
    ],
    "cameras": [
      {
        "label": "低角度仰拍",
        "position": {
          "x": 0,
          "y": 0.6,
          "z": 1
        },
        "lookAt": {
          "x": 0,
          "y": 1.7,
          "z": -2
        },
        "fov": 50
      },
      {
        "id": "front_wide",
        "label": "正面全景",
        "position": {
          "x": 0,
          "y": 1.8,
          "z": 8
        },
        "lookAt": {
          "x": 0,
          "y": 1,
          "z": 0
        },
        "fov": 65
      }
    ],
    "props": [
      {
        "assetId": "image_board",
        "position": {
          "x": 0,
          "y": 0,
          "z": -3.2
        },
        "scale": 1.6
      }
    ]
  },
  {
    "id": "press_conf",
    "label": "新闻发布会",
    "category": "教学 · 演讲",
    "description": "2 位发言人长桌落座，背景板正对媒体机位",
    "characters": [
      {
        "offset": {
          "x": -0.55,
          "y": -0.45,
          "z": -1.55
        },
        "rotation": 0,
        "pose": "sit",
        "role": "发言人A"
      },
      {
        "offset": {
          "x": 0.55,
          "y": -0.45,
          "z": -1.55
        },
        "rotation": 0,
        "pose": "sit",
        "role": "发言人B"
      }
    ],
    "cameras": [
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "front_close",
        "label": "正面特写",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 2
        },
        "lookAt": {
          "x": 0,
          "y": 1.5,
          "z": 0
        },
        "fov": 35
      }
    ],
    "props": [
      {
        "assetId": "table_rect",
        "position": {
          "x": 0,
          "y": 0,
          "z": -1
        },
        "scale": 1.4
      },
      {
        "assetId": "image_board",
        "position": {
          "x": 0,
          "y": 0,
          "z": -2.4
        },
        "scale": 1.4
      },
      {
        "assetId": "chair",
        "position": {
          "x": -0.55,
          "y": 0,
          "z": -1.55
        }
      },
      {
        "assetId": "chair",
        "position": {
          "x": 0.55,
          "y": 0,
          "z": -1.55
        }
      }
    ]
  },
  {
    "id": "cafe_chat",
    "label": "咖啡厅会面",
    "category": "生活 · 剧情",
    "description": "2 人围圆桌对坐闲谈，背景墙营造室内感",
    "characters": [
      {
        "offset": {
          "x": -0.8,
          "y": -0.45,
          "z": 0
        },
        "rotation": 90,
        "pose": "sit",
        "role": "角色A"
      },
      {
        "offset": {
          "x": 0.8,
          "y": -0.45,
          "z": 0
        },
        "rotation": -90,
        "pose": "sit",
        "role": "角色B"
      }
    ],
    "cameras": [
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      },
      {
        "label": "过肩镜头",
        "position": {
          "x": -1.5,
          "y": 1.25,
          "z": 0.5
        },
        "lookAt": {
          "x": 0.8,
          "y": 1.05,
          "z": 0
        },
        "fov": 45
      },
      {
        "label": "过肩镜头 (右)",
        "position": {
          "x": 1.5,
          "y": 1.25,
          "z": 0.5
        },
        "lookAt": {
          "x": -0.8,
          "y": 1.05,
          "z": 0
        },
        "fov": 45
      }
    ],
    "props": [
      {
        "assetId": "table_round",
        "position": {
          "x": 0,
          "y": 0,
          "z": 0
        }
      },
      {
        "assetId": "chair",
        "position": {
          "x": -0.8,
          "y": 0,
          "z": 0
        },
        "rotation": 90
      },
      {
        "assetId": "chair",
        "position": {
          "x": 0.8,
          "y": 0,
          "z": 0
        },
        "rotation": -90
      },
      {
        "assetId": "wall_3m",
        "position": {
          "x": 0,
          "y": 0,
          "z": -2.5
        }
      },
      {
        "assetId": "bush",
        "position": {
          "x": -2,
          "y": 0,
          "z": -1.8
        }
      }
    ]
  },
  {
    "id": "park_rest",
    "label": "公园小憩",
    "category": "生活 · 剧情",
    "description": "1 人长椅独坐，树木路灯环绕，安静氛围",
    "characters": [
      {
        "offset": {
          "x": 0.25,
          "y": -0.45,
          "z": 0.05
        },
        "rotation": 0,
        "pose": "sit",
        "role": "路人"
      }
    ],
    "cameras": [
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "side_close",
        "label": "侧面近景",
        "position": {
          "x": 2,
          "y": 1.6,
          "z": 0
        },
        "lookAt": {
          "x": 0,
          "y": 1.4,
          "z": 0
        },
        "fov": 40
      }
    ],
    "props": [
      {
        "assetId": "bench",
        "position": {
          "x": 0,
          "y": 0,
          "z": 0
        }
      },
      {
        "assetId": "tree_large",
        "position": {
          "x": -2.8,
          "y": 0,
          "z": -1.5
        }
      },
      {
        "assetId": "tree_small",
        "position": {
          "x": 2.5,
          "y": 0,
          "z": -2
        }
      },
      {
        "assetId": "bush",
        "position": {
          "x": -1.5,
          "y": 0,
          "z": 1.2
        }
      },
      {
        "assetId": "streetlamp",
        "position": {
          "x": 1.8,
          "y": 0,
          "z": 1
        }
      }
    ]
  },
  {
    "id": "street_walk",
    "label": "街头同行",
    "category": "生活 · 剧情",
    "description": "2 人并肩行走迎向镜头，侧面跟拍 + 远景跟踪",
    "characters": [
      {
        "offset": {
          "x": -0.45,
          "z": 0
        },
        "rotation": 0,
        "pose": "walk",
        "role": "角色A"
      },
      {
        "offset": {
          "x": 0.45,
          "z": 0
        },
        "rotation": 0,
        "pose": "walk",
        "role": "角色B"
      }
    ],
    "cameras": [
      {
        "id": "side_follow",
        "label": "侧面跟拍",
        "position": {
          "x": 3,
          "y": 1.5,
          "z": 3
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 60
      },
      {
        "id": "tracking_wide",
        "label": "远景跟踪",
        "position": {
          "x": 5,
          "y": 2,
          "z": 8
        },
        "lookAt": {
          "x": 0,
          "y": 1,
          "z": 0
        },
        "fov": 35
      },
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      }
    ],
    "props": [
      {
        "assetId": "streetlamp",
        "position": {
          "x": 2.4,
          "y": 0,
          "z": -2
        }
      },
      {
        "assetId": "tree_small",
        "position": {
          "x": -2.6,
          "y": 0,
          "z": -1
        }
      },
      {
        "assetId": "trash_bin",
        "position": {
          "x": 2,
          "y": 0,
          "z": 1
        }
      }
    ]
  },
  {
    "id": "farewell",
    "label": "街头道别",
    "category": "生活 · 剧情",
    "description": "一人挥手送别，一人转身离去，叙事感构图",
    "characters": [
      {
        "offset": {
          "x": -0.8,
          "z": 0.5
        },
        "rotation": 140,
        "pose": "wave",
        "role": "送别者"
      },
      {
        "offset": {
          "x": 1,
          "z": -1.5
        },
        "rotation": 180,
        "pose": "walk",
        "role": "离开者"
      }
    ],
    "cameras": [
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "side_follow",
        "label": "侧面跟拍",
        "position": {
          "x": 3,
          "y": 1.5,
          "z": 3
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 60
      }
    ],
    "props": [
      {
        "assetId": "streetlamp",
        "position": {
          "x": -2.2,
          "y": 0,
          "z": -1
        }
      }
    ]
  },
  {
    "id": "car_dialogue",
    "label": "车内对话",
    "category": "生活 · 剧情",
    "description": "2 人车内并排而坐，POV 与侧窗机位",
    "characters": [
      {
        "offset": {
          "x": -0.35,
          "y": -0.3,
          "z": 0
        },
        "rotation": 0,
        "pose": "sit",
        "role": "驾驶员"
      },
      {
        "offset": {
          "x": 0.35,
          "y": -0.3,
          "z": 0
        },
        "rotation": 0,
        "pose": "sit",
        "role": "乘客"
      }
    ],
    "cameras": [
      {
        "id": "pov_eye",
        "label": "POV 第一视角",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 0
        },
        "lookAt": {
          "x": 0,
          "y": 1.5,
          "z": -3
        },
        "fov": 75
      },
      {
        "id": "side_close",
        "label": "侧面近景",
        "position": {
          "x": 2,
          "y": 1.6,
          "z": 0
        },
        "lookAt": {
          "x": 0,
          "y": 1.4,
          "z": 0
        },
        "fov": 40
      }
    ],
    "props": [
      {
        "assetId": "car",
        "position": {
          "x": 0,
          "y": 0,
          "z": 0
        }
      }
    ]
  },
  {
    "id": "chase",
    "label": "追逐戏",
    "category": "动作 · 情绪",
    "description": "前后追逐奔跑，侧面跟拍 + 低角度强化速度感",
    "characters": [
      {
        "offset": {
          "x": 0,
          "z": 0.8
        },
        "rotation": 0,
        "pose": "run",
        "role": "逃跑者"
      },
      {
        "offset": {
          "x": 0.3,
          "z": -1.2
        },
        "rotation": 0,
        "pose": "run",
        "role": "追逐者"
      }
    ],
    "cameras": [
      {
        "id": "side_follow",
        "label": "侧面跟拍",
        "position": {
          "x": 3,
          "y": 1.5,
          "z": 3
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 60
      },
      {
        "id": "low_angle",
        "label": "低角度仰拍",
        "position": {
          "x": 0,
          "y": 0.5,
          "z": 3
        },
        "lookAt": {
          "x": 0,
          "y": 1.6,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "tracking_wide",
        "label": "远景跟踪",
        "position": {
          "x": 5,
          "y": 2,
          "z": 8
        },
        "lookAt": {
          "x": 0,
          "y": 1,
          "z": 0
        },
        "fov": 35
      }
    ],
    "props": []
  },
  {
    "id": "fight_scene",
    "label": "对峙打斗",
    "category": "动作 · 情绪",
    "description": "2 人格斗架势对峙，荷兰角 + 低角度广角",
    "characters": [
      {
        "offset": {
          "x": -0.7,
          "z": 0
        },
        "rotation": 90,
        "pose": "fight",
        "role": "角色A"
      },
      {
        "offset": {
          "x": 0.7,
          "z": 0
        },
        "rotation": -90,
        "pose": "fight",
        "role": "角色B"
      }
    ],
    "cameras": [
      {
        "id": "dutch_angle",
        "label": "荷兰角",
        "position": {
          "x": 2,
          "y": 1.8,
          "z": 3
        },
        "lookAt": {
          "x": 0,
          "y": 1.3,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "low_wide",
        "label": "低角度广角",
        "position": {
          "x": 0,
          "y": 0.3,
          "z": 2.5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 80
      },
      {
        "id": "front_medium",
        "label": "正面中景",
        "position": {
          "x": 0,
          "y": 1.6,
          "z": 5
        },
        "lookAt": {
          "x": 0,
          "y": 1.2,
          "z": 0
        },
        "fov": 50
      }
    ],
    "props": []
  },
  {
    "id": "dance_stage",
    "label": "舞蹈表演",
    "category": "动作 · 情绪",
    "description": "C 位舞者领舞，两侧伴舞呼应，舞台机位",
    "characters": [
      {
        "offset": {
          "x": 0,
          "z": 0.3
        },
        "rotation": 0,
        "pose": "dance",
        "role": "领舞"
      },
      {
        "offset": {
          "x": -1.3,
          "z": -0.7
        },
        "rotation": 0,
        "pose": "celebrate",
        "role": "伴舞A"
      },
      {
        "offset": {
          "x": 1.3,
          "z": -0.7
        },
        "rotation": 0,
        "pose": "celebrate",
        "role": "伴舞B"
      }
    ],
    "cameras": [
      {
        "id": "front_wide",
        "label": "正面全景",
        "position": {
          "x": 0,
          "y": 1.8,
          "z": 8
        },
        "lookAt": {
          "x": 0,
          "y": 1,
          "z": 0
        },
        "fov": 65
      },
      {
        "id": "low_angle",
        "label": "低角度仰拍",
        "position": {
          "x": 0,
          "y": 0.5,
          "z": 3
        },
        "lookAt": {
          "x": 0,
          "y": 1.6,
          "z": 0
        },
        "fov": 50
      }
    ],
    "props": []
  },
  {
    "id": "victory",
    "label": "庆祝时刻",
    "category": "动作 · 情绪",
    "description": "3 人欢呼庆祝，低角度仰拍渲染情绪高点",
    "characters": [
      {
        "offset": {
          "x": 0,
          "z": 0
        },
        "rotation": 0,
        "pose": "celebrate",
        "role": "角色A"
      },
      {
        "offset": {
          "x": -1.1,
          "z": -0.4
        },
        "rotation": 0,
        "pose": "hands_up",
        "role": "角色B"
      },
      {
        "offset": {
          "x": 1.1,
          "z": -0.4
        },
        "rotation": 0,
        "pose": "jump",
        "role": "角色C"
      }
    ],
    "cameras": [
      {
        "id": "low_angle",
        "label": "低角度仰拍",
        "position": {
          "x": 0,
          "y": 0.5,
          "z": 3
        },
        "lookAt": {
          "x": 0,
          "y": 1.6,
          "z": 0
        },
        "fov": 50
      },
      {
        "id": "front_wide",
        "label": "正面全景",
        "position": {
          "x": 0,
          "y": 1.8,
          "z": 8
        },
        "lookAt": {
          "x": 0,
          "y": 1,
          "z": 0
        },
        "fov": 65
      }
    ],
    "props": []
  }
];
export const SCENE_BODY_TYPES: readonly SceneBodyType[] = [
  {
    "id": "mannequin",
    "label": "标准素体",
    "icon": "🤖",
    "description": "标准关节人偶素体"
  },
  {
    "id": "mannequin_female",
    "label": "女性素体",
    "icon": "👤",
    "description": "女性比例关节人偶"
  },
  {
    "id": "mannequin_child",
    "label": "儿童素体",
    "icon": "🧒",
    "description": "儿童比例关节人偶"
  },
  {
    "id": "mannequin_stocky",
    "label": "壮实素体",
    "icon": "💪",
    "description": "壮实体型关节人偶"
  },
  {
    "id": "mannequin_slim",
    "label": "纤细素体",
    "icon": "🦒",
    "description": "高挑纤细关节人偶"
  },
  {
    "id": "group3",
    "label": "群众 (3人)",
    "icon": "👥",
    "description": "一排3个素体人偶"
  },
  {
    "id": "group5",
    "label": "群众 (5人)",
    "icon": "👨‍👩‍👧‍👦",
    "description": "一排5个素体人偶"
  }
];
export const SCENE_JOINT_GROUPS: readonly SceneJointGroup[] = [
  {
    "group": "整体",
    "joints": [
      {
        "key": "body",
        "label": "身体",
        "props": [
          {
            "key": "bend",
            "label": "前倾",
            "min": -45,
            "max": 45
          },
          {
            "key": "turn",
            "label": "转身",
            "min": -180,
            "max": 180
          },
          {
            "key": "tilt",
            "label": "侧倾",
            "min": -30,
            "max": 30
          }
        ]
      }
    ]
  },
  {
    "group": "上半身",
    "joints": [
      {
        "key": "torso",
        "label": "躯干",
        "props": [
          {
            "key": "bend",
            "label": "前倾",
            "min": -45,
            "max": 45
          },
          {
            "key": "turn",
            "label": "扭转",
            "min": -90,
            "max": 90
          },
          {
            "key": "tilt",
            "label": "侧倾",
            "min": -45,
            "max": 45
          }
        ]
      },
      {
        "key": "head",
        "label": "头部",
        "props": [
          {
            "key": "nod",
            "label": "点头",
            "min": -40,
            "max": 40
          },
          {
            "key": "turn",
            "label": "转头",
            "min": -90,
            "max": 90
          },
          {
            "key": "tilt",
            "label": "歪头",
            "min": -40,
            "max": 40
          }
        ]
      }
    ]
  },
  {
    "group": "手臂",
    "joints": [
      {
        "key": "l_arm",
        "label": "左臂",
        "props": [
          {
            "key": "raise",
            "label": "前举",
            "min": -180,
            "max": 180
          },
          {
            "key": "straddle",
            "label": "外展",
            "min": -45,
            "max": 180
          },
          {
            "key": "turn",
            "label": "扭转",
            "min": -90,
            "max": 90
          }
        ]
      },
      {
        "key": "l_elbow",
        "label": "左肘",
        "props": [
          {
            "key": "bend",
            "label": "弯曲",
            "min": 0,
            "max": 160
          }
        ]
      },
      {
        "key": "l_wrist",
        "label": "左腕",
        "props": [
          {
            "key": "bend",
            "label": "屈伸",
            "min": -80,
            "max": 80
          },
          {
            "key": "turn",
            "label": "旋转",
            "min": -90,
            "max": 90
          }
        ]
      },
      {
        "key": "r_arm",
        "label": "右臂",
        "props": [
          {
            "key": "raise",
            "label": "前举",
            "min": -180,
            "max": 180
          },
          {
            "key": "straddle",
            "label": "外展",
            "min": -45,
            "max": 180
          },
          {
            "key": "turn",
            "label": "扭转",
            "min": -90,
            "max": 90
          }
        ]
      },
      {
        "key": "r_elbow",
        "label": "右肘",
        "props": [
          {
            "key": "bend",
            "label": "弯曲",
            "min": 0,
            "max": 160
          }
        ]
      },
      {
        "key": "r_wrist",
        "label": "右腕",
        "props": [
          {
            "key": "bend",
            "label": "屈伸",
            "min": -80,
            "max": 80
          },
          {
            "key": "turn",
            "label": "旋转",
            "min": -90,
            "max": 90
          }
        ]
      }
    ]
  },
  {
    "group": "腿部",
    "joints": [
      {
        "key": "l_leg",
        "label": "左腿",
        "props": [
          {
            "key": "raise",
            "label": "前抬",
            "min": -30,
            "max": 150
          },
          {
            "key": "straddle",
            "label": "外展",
            "min": -10,
            "max": 90
          },
          {
            "key": "turn",
            "label": "扭转",
            "min": -60,
            "max": 60
          }
        ]
      },
      {
        "key": "l_knee",
        "label": "左膝",
        "props": [
          {
            "key": "bend",
            "label": "弯曲",
            "min": 0,
            "max": 160
          }
        ]
      },
      {
        "key": "l_ankle",
        "label": "左踝",
        "props": [
          {
            "key": "bend",
            "label": "勾绷",
            "min": -50,
            "max": 50
          },
          {
            "key": "tilt",
            "label": "内外翻",
            "min": -30,
            "max": 30
          }
        ]
      },
      {
        "key": "r_leg",
        "label": "右腿",
        "props": [
          {
            "key": "raise",
            "label": "前抬",
            "min": -30,
            "max": 150
          },
          {
            "key": "straddle",
            "label": "外展",
            "min": -10,
            "max": 90
          },
          {
            "key": "turn",
            "label": "扭转",
            "min": -60,
            "max": 60
          }
        ]
      },
      {
        "key": "r_knee",
        "label": "右膝",
        "props": [
          {
            "key": "bend",
            "label": "弯曲",
            "min": 0,
            "max": 160
          }
        ]
      },
      {
        "key": "r_ankle",
        "label": "右踝",
        "props": [
          {
            "key": "bend",
            "label": "勾绷",
            "min": -50,
            "max": 50
          },
          {
            "key": "tilt",
            "label": "内外翻",
            "min": -30,
            "max": 30
          }
        ]
      }
    ]
  }
];

export const JOINT_RANGES: Readonly<Record<string, Readonly<Record<string, readonly [number,number]>>>> = Object.fromEntries(SCENE_JOINT_GROUPS.flatMap(g=>g.joints.map(j=>[j.key,Object.fromEntries(j.props.map(p=>[p.key,[p.min,p.max] as const]))])));
export function clampScenePosture(posture: ScenePosture): ScenePosture {
 const out:Record<string,Record<string,number>>={};
 for(const [joint,axes] of Object.entries(JOINT_RANGES)){out[joint]={};for(const [axis,[min,max]] of Object.entries(axes)) {const value=posture[joint]?.[axis]??0;out[joint]![axis]=Math.max(min,Math.min(max,Number.isFinite(value)?value:0));}}
 return out;
}
export function scenePosePosture(id:string, mirror=false):ScenePosture {const pose=SCENE_POSES.find(p=>p.id===id); if(!pose) throw new Error("Unknown pose: "+id); const posture=JSON.parse(JSON.stringify(pose.posture)) as ScenePosture;return mirror?mirrorScenePosture(posture):posture;}
export function createSceneCharacter(id:string, bodyType="mannequin", pose="stand", patch:Partial<SceneObject>={}):SceneObject {
 if(!SCENE_BODY_TYPES.some(b=>b.id===bodyType))throw new Error("Unknown body type: "+bodyType);
 return createSceneObject("character",id,{bodyType,pose,posture:scenePosePosture(pose),...patch});
}
export function createSceneProp(id:string,assetId:string,patch:Partial<SceneObject>={}):SceneObject {const prop=SCENE_PROPS.find(p=>p.id===assetId);if(!prop)throw new Error("Unknown prop: "+assetId);return createSceneObject("prop",id,{assetId,label:prop.name,color:prop.defaultColor,scale:prop.defaultScale,...patch});}
export function createSceneCamera(id:string,presetId="front_medium",patch:Partial<SceneObject>={}):SceneObject {const p=SCENE_CAMERAS.find(c=>c.id===presetId);if(!p)throw new Error("Unknown camera: "+presetId);return createSceneObject("camera",id,{position:p.position,lookAt:p.lookAt,fov:p.fov,label:p.label,...patch});}
export function templateScene(templateId:string,makeId:(hint:string)=>string=(hint)=>hint):SceneDocument {
 const template=SCENE_TEMPLATES.find(t=>t.id===templateId); if(!template)throw new Error("Unknown template: "+templateId);
 return sceneFromTemplate(template,makeId);
}
/** Accepts the documented characters/cameras/props JSON template shape, with the same validation as a saved scene. */
export function sceneFromTemplate(input:unknown,makeId:(hint:string)=>string=(hint)=>hint):SceneDocument {
 if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Scene template must be an object");
 const candidate=input as Record<string,unknown>;
 if(!Array.isArray(candidate.characters)||candidate.cameras!==undefined&&!Array.isArray(candidate.cameras)||candidate.props!==undefined&&!Array.isArray(candidate.props))throw new Error("Scene template needs characters and optional cameras/props arrays");
 for(const item of [...candidate.characters,...(candidate.cameras as unknown[]??[]),...(candidate.props as unknown[]??[])])if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Scene template entries must be objects");
 const template={characters:candidate.characters,cameras:candidate.cameras??[],props:candidate.props??[]} as unknown as Pick<SceneTemplate,"characters"|"cameras"|"props">;
 for(const character of template.characters)if(!character.offset||typeof character.offset!=="object")throw new Error("Template character needs an offset");
 const objects:SceneObject[]=[];
 template.characters.forEach((c,i)=>objects.push(createSceneCharacter(makeId(`character-${i+1}`),c.bodyType??"mannequin",c.pose,{label:c.role,position:{x:c.offset.x,y:c.offset.y??0,z:c.offset.z},rotation:{x:0,y:c.rotation??0,z:0},mirror:c.mirrorPose??false,...(c.color?{color:c.color}:{})})));
 template.cameras.forEach((c,i)=>objects.push(createSceneObject("camera",makeId(`camera-${i+1}`),{label:c.label,position:c.position,lookAt:c.lookAt,fov:c.fov})));
 template.props.forEach((p,i)=>{const preset=SCENE_PROPS.find(item=>item.id===p.assetId)!;const scale=typeof p.scale==="number"?{x:preset.defaultScale.x*p.scale,y:preset.defaultScale.y*p.scale,z:preset.defaultScale.z*p.scale}:p.scale;objects.push(createSceneProp(makeId(`prop-${i+1}`),p.assetId,{position:p.position,rotation:{x:0,y:p.rotation??0,z:0},...(scale?{scale}:{}),...(p.color?{color:p.color}:{})}));});
 return normalizeScene({...createSceneDocument(),objects});
}
export function createSceneCrowd(makeId:(hint:string)=>string,columns=5,rows=3):readonly SceneObject[] {
 const out:SceneObject[]=[];for(let row=0;row<Math.max(1,Math.min(20,Math.floor(rows)));row++)for(let col=0;col<Math.max(1,Math.min(20,Math.floor(columns)));col++)out.push(createSceneCharacter(makeId(`crowd-${row}-${col}`),"mannequin","stand",{position:{x:(col-(columns-1)/2)*0.8,y:0,z:row*0.8},color:["#94A3B8","#F59E0B","#60A5FA","#34D399","#F472B6"][(col+row)%5]}));return out;
}
export function sceneBodyDimensions(bodyType:string):{readonly scale:SceneVector;readonly count:number} {
 switch(bodyType){case "mannequin_female":return {scale:{x:0.88,y:0.96,z:0.9},count:1};case "mannequin_child":return {scale:{x:0.65,y:0.65,z:0.65},count:1};case "mannequin_stocky":return {scale:{x:1.35,y:1,z:1.2},count:1};case "mannequin_slim":return {scale:{x:0.8,y:1.1,z:0.8},count:1};case "group3":return {scale:{x:1,y:1,z:1},count:3};case "group5":return {scale:{x:1,y:1,z:1},count:5};default:return {scale:{x:1,y:1,z:1},count:1};}
}
