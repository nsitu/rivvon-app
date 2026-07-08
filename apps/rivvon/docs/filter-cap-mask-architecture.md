# Filter Cap-Mask Architecture

This note captures the current viewer shader architecture around ribbon cap masks, transparency mapping, and fullscreen post-process filters.

```mermaid
flowchart TD
    subgraph GEO["Geometry / Segment Data"]
        P[Path + interval layout\nRibbonSeries / Ribbon]
        M[Segment mesh geometry]
        A[Per-vertex cap attributes\ncapStartStyle / capEndStyle\ncapStartU / capEndU]
        P --> M --> A
    end

    subgraph SHA["Ribbon Material Shader\nTileManager WebGL / WebGPU"]
        TX[Texture sample]
        CAP[Analytic cap alpha]
        EDGE[Edge-noise alpha]
        FILM[Filmstrip alpha]
        TA[Transparency mapping\nluminance -> alpha scale]
        OUT[Material output color/alpha]

        TX --> OUT
        A --> CAP --> OUT
        EDGE --> OUT
        FILM --> OUT
        OUT --> TA
    end

    subgraph NORM["Normal Scene Render"]
        OPAQUE[Opaque cutout mode\ntransparent = false\ndepthWrite = true\nalphaToCoverage = true]
        SCREEN1[Render scene directly]
        TA --> OPAQUE --> SCREEN1
    end

    subgraph FILTER["Filtered Scene Render\ncontrast / saturation / duotone / B&W"]
        FLAG[Material capability flag\n_hasCapMask = true\non ribbon materials]
        OV1["applyCapMaskFilterOverrides()"]
        TMP[Temporary filter-pass mode\ntransparent = true\ndepthWrite = true\ndepthTest = true\nalphaTest >= 0.05\nalphaToCoverage = false]
        RT[Render scene to offscreen RGBA target]
        QUAD[Fullscreen filter quad\nunpremultiply -> adjust -> premultiply]
        SCREEN2[Render filtered quad to screen]
        OV2["restoreCapMaskFilterOverrides()"]
        CHURN[Per-frame churn\nmaterial flag flips\nneedsUpdate / pipeline changes]

        FLAG --> OV1 --> TMP --> RT --> QUAD --> SCREEN2 --> OV2
        OV1 --> CHURN
        OV2 --> CHURN
    end

    subgraph CONCERNS["Why This Matters"]
        SIMPLE[Contrast / saturation math\nis simple]
        HEAVY[But enabling the filter path\nactivates the cap override cycle]
    end

    SIMPLE --> HEAVY
    FILTER --> HEAVY

    A -. actual styled caps only on some segments .-> FLAG
```

## Notes

- Ribbon materials are normally authored as opaque alpha cutouts with alpha-to-coverage, so cap edges participate in the normal depth pipeline.
- The fullscreen filter path expects a resolved RGBA scene texture and unpremultiplies it before applying contrast, saturation, duotone, or black-and-white transforms.
- To preserve cap-edge behavior in the filtered path, the current implementation temporarily switches cap-masked materials away from alpha-to-coverage and into an alpha-tested blended mode for the offscreen pass, then restores the original flags afterward.
- Because contrast and saturation now activate that same filtered path, they inherit the cap-mask override cost even though the color math itself is lightweight.
