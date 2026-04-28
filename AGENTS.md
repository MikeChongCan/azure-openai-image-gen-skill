# Agent Instructions

This folder is a Codex skill for Azure OpenAI / Microsoft Foundry image generation.

## Scope

- Keep this folder self-contained: `SKILL.md`, `agents/openai.yaml`, `scripts/`, `references/`, and `assets/`.
- Do not add README, changelog, install guide, or other extra docs unless the user explicitly asks.
- Keep `SKILL.md` concise and procedural; put volatile Azure API details in `references/azure-openai-image-api.md`.

## Azure OpenAI Accuracy

- Verify Microsoft Learn / OpenAI docs before changing model availability, endpoint, or parameter claims.
- Do not assume public OpenAI model IDs are valid Azure deployment names.
- Treat `gpt-image-2` Azure availability as deployment, access, and region dependent.
- Preserve base64-output handling for GPT Image series unless current Azure docs say otherwise.
- Preserve `--image` support for reference/edit inputs. Multiple `--image` flags should remain supported up to the documented GPT image edit limit unless current docs change.
- Keep local credentials in `~/.config/env/azure-image-gen.env`; never commit real keys into this skill folder.

## Validation

- After edits, run:
  ```bash
  python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" .
  node --check scripts/generate-image.mjs
  ```
- If the helper script is touched, also run it without env vars and confirm it fails with a clear missing-config message.
