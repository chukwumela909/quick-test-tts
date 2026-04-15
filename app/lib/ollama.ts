import { Ollama } from "ollama";

let _client: Ollama | null = null;

export function getOllamaClient(): Ollama {
  if (!_client) {
    _client = new Ollama({
      host: process.env.OLLAMA_HOST || "http://localhost:11434",
    });
  }
  return _client;
}

export function getModel(): string {
  return process.env.OLLAMA_MODEL || "gemma4:e4b";
}
