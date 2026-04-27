# Azure OpenAI Image API Notes

Last checked: 2026-04-27.

Primary docs:

- Microsoft Learn: `https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/dall-e`
- Microsoft Learn REST reference: `https://learn.microsoft.com/en-us/azure/foundry/openai/reference`
- Azure OpenAI v1 API lifecycle: `https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle`
- OpenAI image generation guide: `https://developers.openai.com/api/docs/guides/image-generation`

## Current Model Notes

Microsoft's image generation guide lists GPT-Image-2 as public preview, GPT-Image-1.5 / GPT-Image-1 / GPT-Image-1-Mini as limited-access previews, and says the DALL-E 3 image generation model was retired on March 4, 2026. Use a `gpt-image-*` deployment for Azure image generation.

GPT Image series Azure deployments accept text plus image inputs and output base64 images, not image URLs. Save the base64 payload to a file before presenting results.

GPT-Image-2 supports arbitrary resolutions with both edges as multiples of 16 px, long edge up to 3840 px, aspect ratio up to 3:1, and quality values `low`, `medium`, `high`.

OpenAI's Image API docs describe two GPT Image endpoints:

- `/images/generations` for text-to-image.
- `/images/edits` for modifying existing images from a prompt.

For GPT image models, edits can take multiple source/reference images. OpenAI documents up to 16 images for image edits; Azure support still depends on deployment/model/API version.

## Endpoint Patterns

Azure APIs are deployment-based. Older dated API versions commonly use routes like:

```text
POST {AZURE_OPENAI_ENDPOINT}/openai/deployments/{AZURE_OPENAI_DEPLOYMENT}/images/generations?api-version={AZURE_OPENAI_API_VERSION}
api-key: {AZURE_OPENAI_API_KEY}
```

Reference-image/edit calls use multipart form data:

```text
POST {AZURE_OPENAI_ENDPOINT}/openai/deployments/{AZURE_OPENAI_DEPLOYMENT}/images/edits?api-version={AZURE_OPENAI_API_VERSION}
api-key: {AZURE_OPENAI_API_KEY}
form fields: prompt, image, image, mask, size, quality, n
```

Azure's newer v1 API removes dated `api-version` parameters for supported APIs and is designed for OpenAI-compatible clients with Azure endpoint configuration. Confirm the specific image endpoint and preview headers before converting existing code to v1.

## Request Body Shape

Start with the smallest portable payload:

```json
{
  "prompt": "Subject: ...",
  "size": "1536x1024",
  "quality": "high",
  "n": 1
}
```

Then add model-specific fields only after confirming support for that deployment. Azure can reject options that public OpenAI accepts or that are only available for some image model versions.

For edits, send multipart form data rather than JSON. Repeat the `image` file field for multiple reference images unless current Azure docs show a different field convention for the chosen API version.

## Auth

Azure OpenAI supports:

- API key auth with `api-key` header.
- Microsoft Entra ID bearer token auth with `Authorization: Bearer <token>`.

Use key auth for quick local generation. Use Entra ID in production Azure-hosted systems when identity is already configured.

## Troubleshooting

- `404` or "DeploymentNotFound": wrong deployment name, wrong resource endpoint, model not deployed, or deployment not yet propagated.
- `400` unknown parameter: remove optional fields and retry with prompt + size + quality + n.
- `401` or `403`: wrong API key, wrong resource, missing Entra role, or using a key against the wrong endpoint.
- No URL in response: expected for GPT Image series; decode `data[].b64_json`.
