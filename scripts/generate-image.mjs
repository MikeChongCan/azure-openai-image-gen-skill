#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function args(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}`) {
      values.push(process.argv[index + 1]);
    }
  }
  return values.filter(Boolean);
}

function optionalNumber(name) {
  const value = arg(name);
  return value === undefined ? undefined : Number(value);
}

function appendOptional(form, name, value) {
  if (value !== undefined && value !== "") {
    form.append(name, String(value));
  }
}

function contentTypeFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function loadEnvFile(file) {
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    const value = rawValue
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
  process.env[key] = value;
  }
}

async function appendImageFile(form, field, file) {
  const absoluteFile = path.resolve(file);
  const bytes = await readFile(absoluteFile);
  const blob = new Blob([bytes], { type: contentTypeFor(absoluteFile) });
  form.append(field, blob, path.basename(absoluteFile));
}

function generationBody(prompt) {
  const body = {
    prompt,
    size: arg("size", "1536x1024"),
    quality: arg("quality", "high"),
    n: Number(arg("n", "1")),
  };

  for (const [flag, key] of [
    ["background", "background"],
    ["moderation", "moderation"],
    ["output-format", "output_format"],
  ]) {
    const value = arg(flag);
    if (value !== undefined) body[key] = value;
  }

  const outputCompression = optionalNumber("output-compression");
  if (outputCompression !== undefined) {
    body.output_compression = outputCompression;
  }

  return body;
}

async function editBody(prompt, imageFiles) {
  if (imageFiles.length > 16) {
    throw new Error("GPT image edit inputs support up to 16 reference images");
  }

  const form = new FormData();
  form.append("prompt", prompt);
  appendOptional(form, "size", arg("size", "1536x1024"));
  appendOptional(form, "quality", arg("quality", "high"));
  appendOptional(form, "n", arg("n", "1"));
  appendOptional(form, "background", arg("background"));
  appendOptional(form, "input_fidelity", arg("input-fidelity"));
  appendOptional(form, "moderation", arg("moderation"));
  appendOptional(form, "output_format", arg("output-format"));
  appendOptional(form, "output_compression", arg("output-compression"));

  const imageField = arg("image-field", "image");
  for (const imageFile of imageFiles) {
    await appendImageFile(form, imageField, imageFile);
  }

  const maskFile = arg("mask");
  if (maskFile) {
    await appendImageFile(form, "mask", maskFile);
  }

  return form;
}

async function main() {
  const envFile = path.resolve(arg("config-env-file", path.join(os.homedir(), ".config/env/azure-image-gen.env")));
  await loadEnvFile(envFile);

  const endpoint = requiredEnv("AZURE_OPENAI_ENDPOINT").replace(/\/+$/, "");
  const deployment = requiredEnv("AZURE_OPENAI_DEPLOYMENT");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const bearer = process.env.AZURE_OPENAI_BEARER_TOKEN;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";

  if (!apiKey && !bearer) {
    throw new Error("Set AZURE_OPENAI_API_KEY or AZURE_OPENAI_BEARER_TOKEN");
  }

  const promptFile = arg("prompt-file");
  const prompt = promptFile ? await readFile(promptFile, "utf8") : arg("prompt");
  if (!prompt) {
    throw new Error("Pass --prompt \"...\" or --prompt-file prompt.txt");
  }

  const imageFiles = args("image");
  const operation = imageFiles.length ? "edits" : "generations";
  const body = imageFiles.length ? await editBody(prompt, imageFiles) : generationBody(prompt);
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/images/${operation}?api-version=${encodeURIComponent(apiVersion)}`;
  const headers = {
    ...(apiKey ? { "api-key": apiKey } : { authorization: `Bearer ${bearer}` }),
  };
  if (!(body instanceof FormData)) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: body instanceof FormData ? body : JSON.stringify(body),
  });

  const payload = await response.json().catch(async () => ({ error: await response.text() }));
  if (!response.ok) {
    throw new Error(`Azure image generation failed (${response.status}): ${JSON.stringify(payload, null, 2)}`);
  }

  const outDir = path.resolve(arg("out", "azure-image-output"));
  await mkdir(outDir, { recursive: true });

  const images = payload.data || [];
  if (!images.length) {
    throw new Error(`No images returned: ${JSON.stringify(payload, null, 2)}`);
  }

  for (const [index, image] of images.entries()) {
    if (!image.b64_json) {
      throw new Error(`Image ${index} did not include b64_json: ${JSON.stringify(image, null, 2)}`);
    }
    const file = path.join(outDir, `image-${String(index + 1).padStart(2, "0")}.png`);
    await writeFile(file, Buffer.from(image.b64_json, "base64"));
    console.log(file);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
