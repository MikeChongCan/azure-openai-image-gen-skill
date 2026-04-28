#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const COMMANDS = new Set(["generate", "edit", "generate-batch"]);

function usage() {
  return `Usage:
  node scripts/generate-image.mjs generate --prompt "..." [--config-env-file .env] [--out output/imagegen]
  node scripts/generate-image.mjs edit --prompt "..." --image input.png [--mask mask.png]
  node scripts/generate-image.mjs generate-batch --batch-file prompts.jsonl [--out output/imagegen]

Environment:
  Loads ~/.config/env/azure-image-gen.env by default.
  Override with --config-env-file <file>.
  Shell environment variables override env-file values.

Required config:
  AZURE_OPENAI_ENDPOINT
  AZURE_OPENAI_DEPLOYMENT
  AZURE_OPENAI_API_KEY or AZURE_OPENAI_BEARER_TOKEN

Batch JSONL:
  {"prompt":"...","name":"hero","size":"1536x1024","quality":"high"}`;
}

function command() {
  const candidate = process.argv[2];
  if (COMMANDS.has(candidate)) return candidate;
  return undefined;
}

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) return fallback;
  return value;
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

function valueFrom(options, key, flag, fallback = undefined) {
  if (options[key] !== undefined) return options[key];
  const snakeFlag = flag.replace(/-/g, "_");
  if (options[snakeFlag] !== undefined) return options[snakeFlag];
  if (options[flag] !== undefined) return options[flag];
  return arg(flag, fallback);
}

function numberFrom(options, key, flag) {
  const value = valueFrom(options, key, flag);
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
    throw new Error(`Missing ${name}. Set it in the shell or in the env file.`);
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

function generationBody(prompt, options = {}) {
  const body = {
    prompt,
    size: valueFrom(options, "size", "size", "1536x1024"),
    quality: valueFrom(options, "quality", "quality", "high"),
    n: Number(valueFrom(options, "n", "n", "1")),
  };

  for (const [flag, key] of [
    ["background", "background"],
    ["moderation", "moderation"],
    ["output-format", "output_format"],
  ]) {
    const optionKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = valueFrom(options, optionKey, flag);
    if (value !== undefined) body[key] = value;
  }

  const outputCompression = numberFrom(options, "outputCompression", "output-compression");
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

function envFilePath() {
  return path.resolve(arg("config-env-file", path.join(os.homedir(), ".config/env/azure-image-gen.env")));
}

function authConfig() {
  const endpoint = requiredEnv("AZURE_OPENAI_ENDPOINT").replace(/\/+$/, "");
  const deployment = requiredEnv("AZURE_OPENAI_DEPLOYMENT");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const bearer = process.env.AZURE_OPENAI_BEARER_TOKEN;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";

  if (!apiKey && !bearer) {
    throw new Error("Set AZURE_OPENAI_API_KEY or AZURE_OPENAI_BEARER_TOKEN in the shell or env file.");
  }

  return { endpoint, deployment, apiKey, bearer, apiVersion };
}

async function requestAzure({ operation, body, config }) {
  const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/images/${operation}?api-version=${encodeURIComponent(config.apiVersion)}`;
  const headers = {
    ...(config.apiKey ? { "api-key": config.apiKey } : { authorization: `Bearer ${config.bearer}` }),
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

  return payload;
}

function safeName(value, fallback) {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

async function writeImages(payload, outDir, prefix = "image") {
  await mkdir(outDir, { recursive: true });

  const images = payload.data || [];
  if (!images.length) {
    throw new Error(`No images returned: ${JSON.stringify(payload, null, 2)}`);
  }

  const files = [];
  for (const [index, image] of images.entries()) {
    if (!image.b64_json) {
      throw new Error(`Image ${index} did not include b64_json: ${JSON.stringify(image, null, 2)}`);
    }
    const file = path.join(outDir, `${safeName(prefix, "image")}-${String(index + 1).padStart(2, "0")}.png`);
    await writeFile(file, Buffer.from(image.b64_json, "base64"));
    console.log(file);
    files.push(file);
  }

  return files;
}

async function promptFromArgs() {
  const promptFile = arg("prompt-file");
  const prompt = promptFile ? await readFile(promptFile, "utf8") : arg("prompt");
  if (!prompt) {
    throw new Error("Pass --prompt \"...\" or --prompt-file prompt.txt");
  }
  return prompt;
}

async function runSingle({ mode, config }) {
  const prompt = await promptFromArgs();
  const imageFiles = args("image");
  const operation = mode === "edit" || imageFiles.length ? "edits" : "generations";

  if (mode === "edit" && imageFiles.length === 0) {
    throw new Error("The edit command requires at least one --image input.");
  }

  const body = imageFiles.length ? await editBody(prompt, imageFiles) : generationBody(prompt);
  const payload = await requestAzure({ operation, body, config });
  const outDir = path.resolve(arg("out", "output/imagegen"));
  await writeImages(payload, outDir, arg("name", operation === "edits" ? "edit" : "image"));
}

async function runBatch({ config }) {
  const batchFile = arg("batch-file");
  if (!batchFile) {
    throw new Error("Pass --batch-file prompts.jsonl for generate-batch.");
  }

  const outDir = path.resolve(arg("out", "output/imagegen"));
  const contents = await readFile(batchFile, "utf8");
  const lines = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    throw new Error(`No batch jobs found in ${batchFile}`);
  }

  for (const [lineIndex, line] of lines.entries()) {
    let job;
    try {
      job = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on batch line ${lineIndex + 1}: ${error.message}`);
    }
    if (!job.prompt) {
      throw new Error(`Batch line ${lineIndex + 1} is missing "prompt"`);
    }

    const payload = await requestAzure({
      operation: "generations",
      body: generationBody(job.prompt, job),
      config,
    });
    const prefix = job.name || `job-${String(lineIndex + 1).padStart(2, "0")}`;
    await writeImages(payload, outDir, prefix);
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const mode = command();
  if (process.argv[2] && !mode && process.argv[2].startsWith("-") === false) {
    throw new Error(`Unknown command "${process.argv[2]}".\n${usage()}`);
  }

  const envFile = envFilePath();
  await loadEnvFile(envFile);

  const config = authConfig();
  const selectedMode = mode || (args("image").length ? "edit" : "generate");

  if (selectedMode === "generate-batch") {
    await runBatch({ config });
  } else {
    await runSingle({ mode: selectedMode, config });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
