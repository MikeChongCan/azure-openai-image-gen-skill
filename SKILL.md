---
name: azure-openai-image-gen-skill
description: Generate, edit, batch-generate, or troubleshoot images through Azure OpenAI or Microsoft Foundry image model deployments using env vars or an env-file. Use for GPT Image, gpt-image-2, gpt-image-1.5, gpt-image-1, Azure OpenAI image generation, deployment-based image APIs, base64 image outputs, or an Azure-backed alternative to image_gen.
---

# Azure OpenAI Image Generation Skill

Generates or edits images for the current project through an Azure OpenAI deployment instead of the built-in `image_gen` tool.

## Top-level modes and rules

This skill has exactly two top-level modes:

- **Default Azure helper mode (preferred):** bundled `scripts/generate-image.mjs` for normal image generation, edits/reference images, batches, and simple transparent-image requests. Requires Azure OpenAI config from environment variables or an env file.
- **Implementation mode:** write or patch the user's application code to call Azure OpenAI directly, using the same request shape as the helper. Use this when the user is integrating image generation into a repo rather than generating an asset now.

Within Azure helper mode, the CLI exposes three subcommands:

- `generate`
- `edit`
- `generate-batch`

Rules:
- Use Azure helper mode by default for Azure image generation and editing requests.
- Do not use the built-in `image_gen` tool for Azure-backed work unless the user explicitly switches away from Azure.
- Do not assume the public model name and Azure deployment name are identical. Azure image routes are deployment-based.
- Load credentials from a defined env file or from the shell environment. The default env file is `~/.config/env/azure-image-gen.env`; override it with `--config-env-file`.
- Existing shell environment variables override values loaded from the env file.
- If the user explicitly asks for a transparent image/background, use Azure helper mode first: prompt for a flat removable chroma-key background, then remove it locally with `$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py`.
- Never silently switch model families for true transparency. If the deployed Azure model rejects `background=transparent` or does not support it, explain that true model-native transparency depends on the deployed model/API version and ask before changing deployment/model assumptions.
- The word `batch` means Azure helper batch mode only when there are multiple prompts or a batch file. Use `generate-batch`; do not simulate distinct prompts with `n`.
- If Azure config is missing, say which variable is missing and ask the user to set either env vars or the env file. Never ask them to paste secrets into chat.
- If Azure rejects an option, reduce optional fields first and retry only when appropriate; Azure deployments can lag public OpenAI feature support.
- Never modify `scripts/generate-image.mjs` during a user image request unless the user is asking to improve this skill or helper.

## Azure configuration

Required:

```bash
AZURE_OPENAI_ENDPOINT="https://<resource>.openai.azure.com"
AZURE_OPENAI_DEPLOYMENT="<deployment-name>"
AZURE_OPENAI_API_KEY="<key>"
```

Optional:

```bash
AZURE_OPENAI_API_VERSION="2025-04-01-preview"
AZURE_OPENAI_BEARER_TOKEN="<entra-id-token>"
```

Use `AZURE_OPENAI_BEARER_TOKEN` instead of `AZURE_OPENAI_API_KEY` when testing Entra ID auth. At least one auth value is required.

Default local env file:

```bash
# ~/.config/env/azure-image-gen.env
AZURE_OPENAI_ENDPOINT="https://<resource>.openai.azure.com"
AZURE_OPENAI_API_KEY="<key>"
AZURE_OPENAI_DEPLOYMENT="<deployment-name>"
AZURE_OPENAI_API_VERSION="2025-04-01-preview"
```

Use another file when needed:

```bash
node scripts/generate-image.mjs generate \
  --config-env-file ./.env.azure-image \
  --prompt "A clean logo mark for a sales analytics product" \
  --out output/imagegen
```

## Save-path policy

- In Azure helper mode, write final artifacts under `output/imagegen/` unless the user names a destination.
- Use `tmp/imagegen/` for intermediate files, prompt files, copied reference inputs, or chroma-key sources.
- If the image is meant for the current project, move or copy the final selected image into the workspace path where the project will reference it.
- Never leave a project-referenced asset only under a temporary output path.
- Do not overwrite an existing asset unless the user explicitly asked for replacement; otherwise create a sibling versioned filename such as `hero-v2.png` or `item-icon-edited.png`.

Shared prompt guidance lives in `references/prompting.md` and `references/sample-prompts.md`.

Azure API notes live in `references/azure-openai-image-api.md`; read that file before making model availability, endpoint, or parameter claims.

Local post-processing helper:
- `$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py`: removes a flat chroma-key background from a generated image and writes a PNG/WebP with alpha. Prefer auto-key sampling, soft matte, and despill for antialiased edges.

## When to use

- Generate a new image through Azure OpenAI.
- Generate a new image using one or more reference images for style, composition, or mood.
- Edit an existing image through Azure OpenAI, including inpainting-like edits where the deployed model/API supports image edits.
- Produce many Azure-generated assets or variants for one task.
- Troubleshoot Azure OpenAI image endpoint, deployment, auth, env-file, base64 output, or request-shape issues.

## When not to use

- The user wants the built-in Codex `image_gen` tool specifically.
- Extending or matching an existing SVG/vector icon set, logo system, or illustration library inside the repo.
- Creating simple shapes, diagrams, wireframes, or icons that are better produced directly in SVG, HTML/CSS, or canvas.
- Making a small project-local asset edit when the source file already exists in an editable native format.
- Any task where the user clearly wants deterministic code-native output instead of a generated bitmap.

## Decision tree

Think about two separate questions:

1. **Intent:** is this a new image or an edit of an existing image?
2. **Execution strategy:** is this one asset or many assets/variants?

Intent:
- If the user wants to modify an existing image while preserving parts of it, treat the request as **edit**.
- If the user provides images only as references for style, composition, mood, or subject guidance, treat the request as **generate with references** and use the Azure edits endpoint only because image inputs require multipart form data.
- If the user provides no images, treat the request as **generate**.

Execution strategy:
- Use `generate` for one text-to-image request.
- Use `edit` for one prompt with one or more image inputs.
- Use `generate-batch` for multiple distinct prompts. Do not use `n` as a substitute for distinct prompts; `n` is for variants of one prompt.

Assume the user wants a new image unless they clearly ask to change an existing one.

## Workflow

1. Decide the top-level mode: Azure helper mode by default; implementation mode only when the user wants repo code that calls Azure.
2. Decide the intent: `generate`, `edit`, or `generate-batch`.
3. Decide whether the output is preview-only or meant to be consumed by the current project.
4. Collect inputs up front: prompt(s), exact text (verbatim), constraints/avoid list, output path, and any input images.
5. For every input image, label its role explicitly:
   - reference image
   - edit target
   - supporting insert/style/compositing input
6. If an edit target is on the local filesystem, inspect it with `view_image` when visual details matter before prompting the edit.
7. If the user asked for a photo, illustration, sprite, product image, banner, or other raster-style asset, use the Azure helper rather than substituting SVG/HTML/CSS placeholders.
8. If the request is for an icon, logo, or UI graphic that should match existing repo-native SVG/vector/code assets, prefer editing those directly unless the user explicitly wants an Azure-generated concept.
9. Augment the prompt based on specificity:
   - If the user's prompt is already specific and detailed, normalize it into a clear spec without adding creative requirements.
   - If the user's prompt is generic, add tasteful augmentation only when it materially improves output quality.
10. Run the helper:
    ```bash
    node scripts/generate-image.mjs generate --prompt-file prompt.txt --size 1536x1024 --quality high --out output/imagegen
    ```
11. For transparent-output requests, follow the transparent image guidance below: generate with Azure on a flat chroma-key background, copy the selected source into `tmp/imagegen/`, run the installed chroma-key helper, and validate the alpha result before using it.
12. Inspect outputs and validate: subject, style, composition, text accuracy, and invariants/avoid items.
13. Iterate with a single targeted change, then re-check.
14. For preview-only work, report the generated file path. The image can remain in `output/imagegen/`.
15. For project-bound work, copy or move the final artifact into the workspace and update any consuming code or references.
16. For batches or multi-asset requests, persist every requested deliverable final in the workspace unless the user explicitly asked to keep outputs preview-only.
17. Always report the final saved path(s), the Azure helper mode used, and any Azure deployment/parameter limitations encountered.

## Transparent image requests

Transparent-image requests still use Azure helper mode first. Because Azure model-native transparency support depends on the deployed model and API version, the default portable path is a removable chroma-key source image followed by local alpha conversion.

Default sequence:

1. Use Azure helper mode to generate the requested subject on a perfectly flat solid chroma-key background.
2. Choose a key color that is unlikely to appear in the subject: default `#00ff00`, use `#ff00ff` for green subjects, and avoid `#0000ff` for blue subjects.
3. Save the selected source image into `tmp/imagegen/`.
4. Run the installed helper path, not a project-relative script path:
   ```bash
   python "${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py" \
     --input <source> \
     --out <final.png> \
     --auto-key border \
     --soft-matte \
     --transparent-threshold 12 \
     --opaque-threshold 220 \
     --despill
   ```
5. Validate that the output has an alpha channel, transparent corners, plausible subject coverage, and no obvious key-color fringe. If a thin fringe remains, retry once with `--edge-contract 1`; use `--edge-feather 0.25` only when the edge is visibly stair-stepped and the subject is not shiny or reflective.
6. Save the final alpha PNG/WebP in the project if the asset is project-bound.

Prompt transparent requests like this:

```text
Create the requested subject on a perfectly flat solid #00ff00 chroma-key background for background removal.
The background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation.
Keep the subject fully separated from the background with crisp edges and generous padding.
Do not use #00ff00 anywhere in the subject.
No cast shadow, no contact shadow, no reflection, no watermark, and no text unless explicitly requested.
```

Do not automatically switch to a different Azure deployment for true transparency. Ask first when the user asks for true/native transparency, when local removal fails validation, or when the requested image is complex: hair, fur, feathers, smoke, glass, liquids, translucent materials, reflective objects, soft shadows, or subject colors that conflict with all practical key colors.

## Prompt augmentation

Reformat user prompts into a structured, production-oriented spec. Make the user's goal clearer and more actionable, but do not blindly add detail.

Use only the lines that help, and add a short extra labeled line when it materially improves clarity.

### Specificity policy

- If the prompt is already specific and detailed, preserve that specificity and only normalize/structure it.
- If the prompt is generic, you may add tasteful augmentation when it will materially improve the result.

Allowed augmentations:
- composition or framing hints
- polish level or intended-use hints
- practical layout guidance
- reasonable scene concreteness that supports the stated request

Not allowed augmentations:
- extra characters or objects that are not implied by the request
- brand names, slogans, palettes, or narrative beats that are not implied
- arbitrary side-specific placement unless the surrounding layout supports it

## Use-case taxonomy

Classify each request into one of these exact slugs and keep the slug consistent across prompts and references.

Generate:
- photorealistic-natural
- product-mockup
- ui-mockup
- infographic-diagram
- scientific-educational
- ads-marketing
- productivity-visual
- logo-brand
- illustration-story
- stylized-concept
- historical-scene

Edit:
- text-localization
- identity-preserve
- precise-object-edit
- lighting-weather
- background-extraction
- style-transfer
- compositing
- sketch-to-render

## Shared prompt schema

Use the following labeled spec as shared prompt scaffolding:

```text
Use case: <taxonomy slug>
Asset type: <where the asset will be used>
Primary request: <user's main prompt>
Input images: <Image 1: role; Image 2: role> (optional)
Scene/backdrop: <environment>
Subject: <main subject>
Style/medium: <photo/illustration/3D/etc>
Composition/framing: <wide/close/top-down; placement>
Lighting/mood: <lighting + mood>
Color palette: <palette notes>
Materials/textures: <surface details>
Text (verbatim): "<exact text>"
Constraints: <must keep/must avoid>
Avoid: <negative constraints>
```

Notes:
- `Asset type` and `Input images` are prompt scaffolding, not dedicated CLI flags.
- `Scene/backdrop` refers to the visual setting. It is not the same as any API `background` parameter.
- Execution notes such as `Quality:`, masks, output format, and output paths belong in helper flags, not in the prompt.

## Helper commands

Generate:

```bash
node scripts/generate-image.mjs generate \
  --prompt-file prompt.txt \
  --size 1536x1024 \
  --quality high \
  --out output/imagegen
```

Edit or generate with reference images:

```bash
node scripts/generate-image.mjs edit \
  --prompt "Turn these references into a premium product render with no text." \
  --image ./reference-1.png \
  --image ./reference-2.jpg \
  --size 1536x1024 \
  --quality high \
  --out output/imagegen
```

Batch:

```bash
node scripts/generate-image.mjs generate-batch \
  --batch-file tmp/imagegen/prompts.jsonl \
  --out output/imagegen
```

Batch file format is JSONL, one prompt job per line:

```jsonl
{"prompt":"A clean hero background for a B2B SaaS app","name":"hero-bg","size":"1536x1024","quality":"high"}
{"prompt":"A minimal app icon concept for a sales dashboard","name":"app-icon","size":"1024x1024","quality":"medium"}
```

## GPT Image guidance for Azure helper mode

- Use the deployment configured by `AZURE_OPENAI_DEPLOYMENT`; do not hard-code public model IDs unless the user's Azure v1 client path explicitly maps `model` to a deployment.
- Verify current Azure support before making model-specific claims. Read `references/azure-openai-image-api.md` when model availability, endpoint shape, or parameter support matters.
- Use `gpt-image-*` deployments for GPT Image workflows.
- Treat returned images as base64-first. Do not expect URL output for GPT Image series deployments.
- Use `quality=low` for fast drafts and thumbnails. Use `medium`, `high`, or deployment-supported defaults for final assets, dense text, diagrams, identity-sensitive edits, or higher-resolution outputs.
- For `gpt-image-2`, prefer concrete dimensions with both edges as multiples of 16 px and within Azure's documented limits. Popular sizes include `1024x1024`, `1536x1024`, `1024x1536`, `2048x2048`, `2048x1152`, `3840x2160`, and `2160x3840`.
- If Azure returns `400` for an optional field, retry with the smallest portable payload: `prompt`, `size`, `quality`, and `n`.

## Dependencies

The helper uses Node.js built-ins available in current Node runtimes, including `fetch`, `Blob`, and `FormData`. No npm install is required for the helper itself.

If local chroma-key removal is needed, use the existing system imagegen helper:

```bash
python "${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py" --help
```

## Environment troubleshooting

If credentials are missing, tell the user to set either env vars or an env file:

```bash
mkdir -p ~/.config/env
$EDITOR ~/.config/env/azure-image-gen.env
```

Never ask the user to paste full keys in chat.

Common errors:
- `Missing AZURE_OPENAI_ENDPOINT`: set the Azure resource endpoint, not the deployment URL.
- `Missing AZURE_OPENAI_DEPLOYMENT`: set the Azure deployment name.
- `Set AZURE_OPENAI_API_KEY or AZURE_OPENAI_BEARER_TOKEN`: provide one auth method.
- `404` or `DeploymentNotFound`: wrong deployment name, wrong resource endpoint, model not deployed, or deployment not propagated.
- `400` unknown parameter: remove optional fields and retry with prompt + size + quality + n.
- `401` or `403`: wrong key, wrong resource, missing Entra role, or using a key against the wrong endpoint.

## Reference map

- `references/prompting.md`: shared prompting principles for Azure helper and implementation modes.
- `references/sample-prompts.md`: shared copy/paste prompt recipes for Azure helper and implementation modes.
- `references/azure-openai-image-api.md`: Azure endpoint, model, auth, and troubleshooting notes.
- `assets/prompt-template.md`: compact prompt scaffold.
- `scripts/generate-image.mjs`: Azure helper implementation. Use it for direct generation, edits, and batches.
