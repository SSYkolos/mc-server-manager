import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { Folder, FileText, Save, CloudUpload, RefreshCw } from "lucide-react";

type AdvancedConfigsProps = {
  serverId: string;
  serverRootFolderId: string;
  accessToken: string;
  serverPath: string; // E.g., the temp path of the server
};

export default function AdvancedConfigs({ serverId, serverRootFolderId, accessToken, serverPath }: AdvancedConfigsProps) {
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState("");

  // 1. Pull Zips from Cloud
  const handlePullFromCloud = async () => {
    setLoading(true);
    setStatus("Downloading live configs from cloud...");
    const res = await window.electronAPI.pullLiveConfigs({ accessToken, serverId, serverRootFolderId, serverPath });
    if (res.success) {
      await loadTree();
      setStatus("Configs loaded.");
    } else {
      setStatus("Error: " + res.error);
    }
    setLoading(false);
  };

  // 2. Load File Tree
  const loadTree = async () => {
    const res = await window.electronAPI.getConfigTree({ serverPath });
    if (res.success && res.tree) setTree(res.tree);
  };

  // 3. Open a File
  const handleOpenFile = async (filePath: string) => {
    if (isDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    
    setStatus("Loading file...");
    const res = await window.electronAPI.readConfigFile({ serverPath, filePath });
    if (res.success) {
      setSelectedFile(filePath);
      setFileContent(res.content || "");
      setIsDirty(false);
      setStatus("");
    }
  };

  // 4. Save locally to Temp Folder
  const handleSaveLocal = async () => {
    if (!selectedFile) return;
    setStatus("Saving locally...");
    const res = await window.electronAPI.saveConfigFile({ serverPath, filePath: selectedFile, content: fileContent });
    if (res.success) {
      setIsDirty(false);
      setStatus("Saved to temp folder.");
    } else {
      setStatus("Failed to save: " + res.error);
    }
  };

  // 5. Deploy back to Google Drive
  const handleDeployToCloud = async () => {
    if (isDirty) await handleSaveLocal(); // Auto-save before pushing
    setLoading(true);
    setStatus("Zipping and uploading to Google Drive...");
    const res = await window.electronAPI.pushLiveConfigs({ accessToken, serverRootFolderId, serverPath });
    if (res.success) {
      setTree([]);
      setSelectedFile(null);
      setStatus("Successfully deployed to cloud! Temp files cleared.");
    } else {
      setStatus("Deployment failed: " + res.error);
    }
    setLoading(false);
  };

  // Helper to figure out syntax highlighting
  const getLanguage = (path: string) => {
    if (path.endsWith(".json")) return "json";
    if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
    if (path.endsWith(".properties") || path.endsWith(".cfg")) return "ini";
    return "plaintext";
  };

  // Render the recursive file tree
  const renderTree = (nodes: any[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div 
          className={`flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-slate-700 ${selectedFile === node.path ? "bg-slate-600 text-blue-400" : "text-slate-300"}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => node.type === "file" && handleOpenFile(node.path)}
        >
          {node.type === "dir" ? <Folder size={14} className="text-amber-400" /> : <FileText size={14} />}
          <span className="text-sm truncate">{node.name}</span>
        </div>
        {node.children && renderTree(node.children, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="flex flex-col h-[700px] border border-slate-700 rounded-lg overflow-hidden bg-[#1e1e1e] text-white">
      {/* TOOLBAR */}
      <div className="flex items-center justify-between p-3 border-b border-slate-700 bg-slate-900 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={handlePullFromCloud} disabled={loading} className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm disabled:opacity-50 transition">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Pull from Cloud
          </button>
        </div>
        
        <div className="text-xs text-slate-400 font-mono truncate px-4">{status}</div>

        <div className="flex items-center gap-3">
          <button onClick={handleSaveLocal} disabled={!isDirty || !selectedFile || loading} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-50 transition">
            <Save size={16} />
            Save Edit
          </button>
          <button onClick={handleDeployToCloud} disabled={tree.length === 0 || loading} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded text-sm disabled:opacity-50 transition">
            <CloudUpload size={16} />
            Deploy to Cloud
          </button>
        </div>
      </div>

      {/* EDITOR AREA */}
      <div className="flex flex-1 overflow-hidden">
        {/* SIDEBAR */}
        <div className="w-64 border-r border-slate-700 bg-[#252526] overflow-y-auto py-2">
          {tree.length === 0 ? (
            <div className="text-xs text-slate-500 p-4 text-center">Click 'Pull from Cloud' to load configs.</div>
          ) : (
            renderTree(tree)
          )}
        </div>

        {/* MONACO */}
        <div className="flex-1 bg-[#1e1e1e] relative">
          {!selectedFile ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500">
              Select a file from the sidebar to edit.
            </div>
          ) : (
            <Editor
              height="100%"
              theme="vs-dark"
              language={getLanguage(selectedFile)}
              value={fileContent}
              onChange={(val) => {
                setFileContent(val || "");
                setIsDirty(true);
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}