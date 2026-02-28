import { useState, useEffect } from "react";
import { useToastStore } from "../../stores/toastStore";
import {
  getShareUploadConfig,
  configureShareUpload,
  testShareUpload,
  removeShareUploadConfig,
  type ShareUploadConfigInput,
} from "../Share/api";

const PROVIDER_PRESETS: {
  label: string;
  endpointUrl: string;
  region: string;
}[] = [
  { label: "AWS S3", endpointUrl: "https://s3.us-east-1.amazonaws.com", region: "us-east-1" },
  { label: "Cloudflare R2", endpointUrl: "", region: "auto" },
  { label: "MinIO", endpointUrl: "http://localhost:9000", region: "us-east-1" },
  { label: "Custom", endpointUrl: "", region: "" },
];

export function ShareUploadSettings() {
  const toastStore = useToastStore();

  const [endpointUrl, setEndpointUrl] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [pathPrefix, setPathPrefix] = useState("nous-shares/");
  const [publicUrlBase, setPublicUrlBase] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const [isConfigured, setIsConfigured] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getShareUploadConfig()
      .then((config) => {
        if (config) {
          setEndpointUrl(config.endpointUrl);
          setBucket(config.bucket);
          setRegion(config.region);
          setPathPrefix(config.pathPrefix);
          setPublicUrlBase(config.publicUrlBase);
          setIsConfigured(true);
        }
      })
      .catch(() => {});
  }, []);

  const buildInput = (): ShareUploadConfigInput => ({
    endpointUrl,
    bucket,
    region,
    pathPrefix,
    publicUrlBase,
    accessKeyId,
    secretAccessKey,
  });

  const handlePreset = (index: number) => {
    const preset = PROVIDER_PRESETS[index];
    setEndpointUrl(preset.endpointUrl);
    setRegion(preset.region);
  };

  const handleTest = async () => {
    if (!endpointUrl || !bucket || !accessKeyId || !secretAccessKey) {
      toastStore.error("Fill in all required fields first");
      return;
    }

    setIsTesting(true);
    try {
      await testShareUpload(buildInput());
      toastStore.success("Connection successful");
    } catch (err) {
      toastStore.error(`Test failed: ${err}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!endpointUrl || !bucket || !accessKeyId || !secretAccessKey) {
      toastStore.error("Fill in all required fields first");
      return;
    }

    setIsSaving(true);
    try {
      await configureShareUpload(buildInput());
      setIsConfigured(true);
      setAccessKeyId("");
      setSecretAccessKey("");
      toastStore.success("Share upload configured");
    } catch (err) {
      toastStore.error(`Save failed: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      await removeShareUploadConfig();
      setEndpointUrl("");
      setBucket("");
      setRegion("");
      setPathPrefix("nous-shares/");
      setPublicUrlBase("");
      setAccessKeyId("");
      setSecretAccessKey("");
      setIsConfigured(false);
      toastStore.success("Share upload configuration removed");
    } catch (err) {
      toastStore.error(`Remove failed: ${err}`);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text-primary)",
    fontSize: "0.85rem",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 500,
    color: "var(--color-text-secondary)",
    marginBottom: 4,
  };

  const fieldStyle: React.CSSProperties = {
    marginBottom: "0.75rem",
  };

  const btnStyle: React.CSSProperties = {
    padding: "0.5rem 1rem",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text-primary)",
    fontSize: "0.85rem",
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", margin: 0 }}>
        Configure S3-compatible storage to upload shared pages publicly. Supports AWS S3, Cloudflare
        R2, MinIO, and any S3-compatible endpoint.
      </p>

      {/* Provider presets */}
      <div>
        <label style={labelStyle}>Provider</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {PROVIDER_PRESETS.map((preset, i) => (
            <button key={preset.label} onClick={() => handlePreset(i)} style={btnStyle}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Form fields */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Endpoint URL *</label>
        <input
          style={inputStyle}
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          placeholder="https://s3.us-east-1.amazonaws.com"
        />
      </div>

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <div style={{ ...fieldStyle, flex: 2 }}>
          <label style={labelStyle}>Bucket *</label>
          <input
            style={inputStyle}
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            placeholder="my-bucket"
          />
        </div>
        <div style={{ ...fieldStyle, flex: 1 }}>
          <label style={labelStyle}>Region</label>
          <input
            style={inputStyle}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="us-east-1"
          />
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Path Prefix</label>
        <input
          style={inputStyle}
          value={pathPrefix}
          onChange={(e) => setPathPrefix(e.target.value)}
          placeholder="nous-shares/"
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Public URL Base</label>
        <input
          style={inputStyle}
          value={publicUrlBase}
          onChange={(e) => setPublicUrlBase(e.target.value)}
          placeholder="https://shares.example.com"
        />
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          Base URL where uploaded files are publicly accessible
        </span>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Access Key ID *</label>
        <input
          style={inputStyle}
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          placeholder={isConfigured ? "(saved)" : "AKIAIOSFODNN7EXAMPLE"}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Secret Access Key *</label>
        <div style={{ position: "relative" }}>
          <input
            style={inputStyle}
            type={showSecret ? "text" : "password"}
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            placeholder={isConfigured ? "(saved)" : ""}
          />
          <button
            onClick={() => setShowSecret(!showSecret)}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
          >
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button onClick={handleTest} disabled={isTesting} style={btnStyle}>
          {isTesting ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            ...btnStyle,
            background: "var(--color-accent, #4f7fff)",
            color: "#fff",
            border: "none",
          }}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
        {isConfigured && (
          <button
            onClick={handleRemove}
            style={{ ...btnStyle, color: "var(--color-error, #cc0000)", marginLeft: "auto" }}
          >
            Remove Configuration
          </button>
        )}
      </div>
    </div>
  );
}
