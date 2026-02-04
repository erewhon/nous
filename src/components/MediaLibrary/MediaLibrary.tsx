import { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as api from "../../utils/api";
import type { MediaAssetInfo } from "../../utils/api";
import { useToastStore } from "../../stores/toastStore";

interface MediaLibraryProps {
  notebookId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function MediaLibrary({ notebookId, isOpen, onClose }: MediaLibraryProps) {
  const [assets, setAssets] = useState<MediaAssetInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<MediaAssetInfo | null>(null);
  const [filter, setFilter] = useState<"all" | "video" | "infographic">("all");
  const toast = useToastStore();

  useEffect(() => {
    if (isOpen) {
      loadAssets();
    }
  }, [isOpen, notebookId]);

  const loadAssets = async () => {
    setIsLoading(true);
    try {
      const mediaAssets = await api.listNotebookMediaAssets(notebookId);
      setAssets(mediaAssets);
    } catch (error) {
      console.error("Failed to load media assets:", error);
      toast.error("Failed to load media library");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (asset: MediaAssetInfo) => {
    if (!confirm(`Delete ${asset.filename}?`)) return;

    try {
      await api.deleteNotebookMediaAsset(notebookId, asset.path);
      setAssets(assets.filter((a) => a.path !== asset.path));
      if (selectedAsset?.path === asset.path) {
        setSelectedAsset(null);
      }
      toast.success("Asset deleted");
    } catch (error) {
      console.error("Failed to delete asset:", error);
      toast.error("Failed to delete asset");
    }
  };

  const filteredAssets = assets.filter((asset) => {
    if (filter === "all") return true;
    return asset.mediaType === filter;
  });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Unknown date";
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Media Library
            </h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Generated videos and infographics for this notebook
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[--color-bg-tertiary]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--color-text-muted)" }}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Filter tabs */}
        <div
          className="flex gap-2 border-b px-6 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          {(["all", "video", "infographic"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                filter === f ? "ring-2 ring-[--color-accent]" : ""
              }`}
              style={{
                backgroundColor:
                  filter === f
                    ? "var(--color-accent)"
                    : "var(--color-bg-secondary)",
                color: filter === f ? "white" : "var(--color-text-primary)",
              }}
            >
              {f === "all" ? "All" : f === "video" ? "Videos" : "Infographics"}
            </button>
          ))}
          <span
            className="ml-auto text-sm self-center"
            style={{ color: "var(--color-text-muted)" }}
          >
            {filteredAssets.length} item{filteredAssets.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div
              className="flex items-center justify-center h-full"
              style={{ color: "var(--color-text-muted)" }}
            >
              Loading...
            </div>
          ) : filteredAssets.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center h-full text-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mb-4 opacity-50"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p>No {filter === "all" ? "media" : filter + "s"} generated yet</p>
              <p className="text-sm mt-1">
                Use the Video or Infographic generators to create media
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {filteredAssets.map((asset) => (
                <div
                  key={asset.path}
                  className={`rounded-lg border overflow-hidden cursor-pointer transition-all hover:shadow-md ${
                    selectedAsset?.path === asset.path
                      ? "ring-2 ring-[--color-accent]"
                      : ""
                  }`}
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                  onClick={() => setSelectedAsset(asset)}
                >
                  {/* Preview */}
                  <div
                    className="h-32 flex items-center justify-center"
                    style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                  >
                    {asset.mediaType === "video" ? (
                      <video
                        src={convertFileSrc(asset.path)}
                        className="h-full w-full object-cover"
                        muted
                      />
                    ) : asset.filename.endsWith(".svg") ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    ) : (
                      <img
                        src={convertFileSrc(asset.path)}
                        className="h-full w-full object-contain"
                        alt={asset.filename}
                      />
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <div
                      className="font-medium text-sm truncate"
                      style={{ color: "var(--color-text-primary)" }}
                      title={asset.filename}
                    >
                      {asset.filename}
                    </div>
                    <div
                      className="flex items-center justify-between mt-1 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <span>{formatSize(asset.sizeBytes)}</span>
                      <span>{formatDate(asset.createdAt)}</span>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(asset);
                      }}
                      className="mt-2 w-full px-2 py-1 rounded text-xs text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t px-6 py-3 text-center text-xs"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          Press{" "}
          <kbd
            className="rounded px-1"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            Esc
          </kbd>{" "}
          to close
        </div>
      </div>
    </div>
  );
}
