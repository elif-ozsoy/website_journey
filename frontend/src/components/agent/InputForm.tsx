import { storageKeys } from '../../lib/storage'
import { useState, FormEvent } from "react";
import { RunConfig } from "./agentTypes";

interface Props { onRun: (config: RunConfig) => void; defaultUrl?: string; defaultTask?: string; }

const EXAMPLES = [
  /*{ url: "https://news.ycombinator.com", task: "Find the top 3 articles and summarize them" },*/
  { url: "https://wikipedia.org", task: "Search for 'Ataturk' and find his birth year" },
  /*{ url: "https://github.com", task: "Navigate to trending repositories and find the most starred one today" },*/
];

const STORAGE_KEY = storageKeys.providerApiKey;

export default function InputForm({ onRun, defaultUrl, defaultTask }: Props) {
  const [url, setUrl] = useState(defaultUrl || "https://wikipedia.org");
  const [task, setTask] = useState(defaultTask || "Search for 'Ataturk' and find his birth year");
  const [provider, setProvider] = useState<"nvidia" | "google">("google");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY("nvidia")) ?? "");
  const [model, setModel] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleProviderChange(p: "nvidia" | "google") {
    setProvider(p);
    setApiKey(localStorage.getItem(STORAGE_KEY(p)) ?? "");
  }

  function handleApiKeyChange(value: string) {
    setApiKey(value);
    localStorage.setItem(STORAGE_KEY(provider), value);
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onRun({ url: url.trim(), task: task.trim(), llm_provider: provider, api_key: apiKey.trim(), model: model.trim() || undefined });
  };

  return (
    <div className="w-full max-w-2xl">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-1">Configure your agent run</h2>
        <p className="text-sm text-gray-400 mb-6">Enter a URL and task — the AI will browse and its journey gets visualized.</p>

        <div className="mb-6">
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide font-medium">Quick examples</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex, i) => (
              <button key={i} type="button" onClick={() => { setUrl(ex.url); setTask(ex.task); }}
                className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full transition-colors text-gray-300">
                {new URL(ex.url).hostname}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Starting URL</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" required
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 focus:border-indigo-500 rounded-lg text-white placeholder-gray-500 outline-none transition-colors" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Task description</label>
            <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="Describe what the agent should do..." required rows={3}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 focus:border-indigo-500 rounded-lg text-white placeholder-gray-500 outline-none transition-colors resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">LLM Provider</label>
              <select value={provider} onChange={(e) => handleProviderChange(e.target.value as "nvidia" | "google")}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white outline-none">
                <option value="nvidia">NVIDIA — Gemma 4 31B (free)</option>
                <option value="google">Google Gemini (free)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">API Key</label>
              <input type="password" value={apiKey} onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder={provider === "nvidia" ? "nvapi-" : "..."} required
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 focus:border-indigo-500 rounded-lg text-white placeholder-gray-500 outline-none  text-sm" />
            </div>
          </div>

          <div>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              {showAdvanced ? "▾" : "▸"} Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Model override <span className="text-gray-500 font-normal">(leave blank for default)</span></label>
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)}
                  placeholder={provider === "nvidia" ? "qwen/qwen3.5-122b-a10b" : "gemini-3-flash-preview"}
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 focus:border-indigo-500 rounded-lg text-white placeholder-gray-500 outline-none  text-sm" />
              </div>
            )}
          </div>

          <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors">
            Run Agent →
          </button>
        </form>
        <p className="mt-4 text-xs text-gray-600 text-center">Your API key is stored locally in your browser.</p>
      </div>
    </div>
  );
}