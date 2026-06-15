import React, { useState, useEffect } from "react";

type DiscoveredModpack = {
  id: string;
  provider: "modrinth" | "curseforge";
  title: string;
  description: string;
  iconUrl?: string;
  downloads?: number;
};

interface ModpackSearchModalProps {
  isOpen: boolean;
  initialQuery?: string;
  onClose: () => void;
  onSelect: (modpackId: string, provider: string) => void;
}

export default function ModpackSearchModal({ isOpen, initialQuery = "", onClose, onSelect }: ModpackSearchModalProps) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [results, setResults] = useState<DiscoveredModpack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      if (initialQuery.trim()) {
        executeSearch(initialQuery, provider);
      }
    } else {
      setResults([]);
      setError("");
    }
  }, [isOpen]);

  const executeSearch = async (searchStr: string, searchProvider: "modrinth" | "curseforge") => {
    if (!searchStr.trim()) return;

    setIsSearching(true);
    setError("");
    setResults([]);

    try {
      const res = await window.electronAPI.searchMods({
        provider: searchProvider,
        query: searchStr,
        isModpack: true,
      });

      if (res.success) {
        setResults(res.results);
      } else {
        setError(res.error || "Search failed.");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSearching(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-xl font-bold text-gray-800">Search Modpacks</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 font-bold text-xl px-2">
            ✕
          </button>
        </div>

        {/* Search Controls */}
        <div className="p-6 border-b border-gray-200 space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setProvider("modrinth");
                executeSearch(query, "modrinth");
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                provider === "modrinth" ? "bg-green-100 text-green-800 border-2 border-green-500" : "bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200"
              }`}
            >
              Modrinth
            </button>
            <button
              type="button"
              onClick={() => {
                setProvider("curseforge");
                executeSearch(query, "curseforge");
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                provider === "curseforge" ? "bg-orange-100 text-orange-800 border-2 border-orange-500" : "bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200"
              }`}
            >
              CurseForge
            </button>
          </div>

          {/* CHANGED FROM <form> TO <div> TO PREVENT NESTED FORM CRASHES */}
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  executeSearch(query, provider);
                }
              }}
              placeholder={`Search ${provider === "modrinth" ? "Modrinth" : "CurseForge"} modpacks...`}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              type="button"
              onClick={() => executeSearch(query, provider)}
              disabled={isSearching || !query.trim()}
              className="px-6 py-2 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition"
            >
              {isSearching ? "Searching..." : "Search"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {results.length === 0 && !isSearching && !error ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              Type a modpack name and hit search...
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((pack) => (
                <div key={pack.id} className="flex items-center gap-4 bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:border-blue-300 transition">
                  <div className="w-16 h-16 flex-shrink-0 bg-gray-100 rounded flex items-center justify-center overflow-hidden border border-gray-200">
                    {pack.iconUrl ? (
                      <img src={pack.iconUrl} alt={pack.title} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-gray-400 text-xs">No Icon</span>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-900 truncate">{pack.title}</h3>
                    <p className="text-sm text-gray-500 line-clamp-2 mt-0.5">{pack.description}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onSelect(pack.id, pack.provider);
                      onClose();
                    }}
                    className="px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 font-semibold rounded-lg hover:bg-blue-600 hover:text-white transition flex-shrink-0"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}